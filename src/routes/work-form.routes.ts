import { Router, Request, Response } from 'express';
import { workFormService } from '../services/work-form.service';
import { vesselComponentService } from '../services/vessel-component.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission } from '../middleware/permissions';
import { requireWorkOrderView, requireWorkOrderWrite } from '../middleware/work-order-access';
import { workOrderService } from '../services/work-order.service';
import prisma from '../config/database';
import { CATEGORY_FIELD_CONFIG, getCategoryConfig } from '../config/category-field-config';
import { type FoulingScale, getScaleLevels, getFoulingScaleRange } from '../constants/fouling-scales';
import { PDR_SCALE, getPdrScaleRange } from '../constants/pdr-scale';
import { ISO_ZONES, ISO_HULL_ZONES, ISO_NICHE_ZONES, ISO_VISIBILITY_CONDITIONS, ISO_AFC_CONDITIONS, ISO_MGPS_CONDITIONS, suggestIsoZone } from '../constants/iso-zones';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

const fleetOrgId = () => process.env.FLEET_ORG_ID || '';

async function assertVesselAccess(req: Request, res: Response, vesselId: string): Promise<boolean> {
  const vessel = await prisma.vessel.findFirst({
    where: { id: vesselId, isDeleted: false },
    select: { organisationId: true },
  });
  if (!vessel) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Vessel not found' } }); return false; }
  if (vessel.organisationId !== req.user!.organisationId && vessel.organisationId !== fleetOrgId()) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Vessel not found' } }); return false;
  }
  return true;
}

async function assertComponentAccess(req: Request, res: Response, componentId: string): Promise<boolean> {
  const comp = await prisma.vesselComponent.findUnique({
    where: { id: componentId },
    select: { vessel: { select: { id: true, organisationId: true, isDeleted: true } } },
  });
  if (!comp || comp.vessel.isDeleted) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Component not found' } }); return false; }
  if (comp.vessel.organisationId !== req.user!.organisationId && comp.vessel.organisationId !== fleetOrgId()) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Component not found' } }); return false;
  }
  return true;
}

// === Vessel Components (General Arrangement) ===

router.get('/vessels/:vesselId/components', authenticate, asyncHandler(async (req, res) => {
  if (!await assertVesselAccess(req, res, req.params.vesselId as string)) return;
  const components = await vesselComponentService.listByVessel(req.params.vesselId as string);
  res.json({ success: true, data: components });
}));

router.post('/vessels/:vesselId/components', authenticate, asyncHandler(async (req, res) => {
  if (!await assertVesselAccess(req, res, req.params.vesselId as string)) return;
  const component = await vesselComponentService.create(req.params.vesselId as string, req.body);
  res.status(201).json({ success: true, data: component });
}));

router.post('/vessels/:vesselId/components/bulk', authenticate, asyncHandler(async (req, res) => {
  if (!await assertVesselAccess(req, res, req.params.vesselId as string)) return;
  const components = await vesselComponentService.bulkCreate(req.params.vesselId as string, req.body.components);
  res.status(201).json({ success: true, data: components });
}));

router.put('/components/:id', authenticate, asyncHandler(async (req, res) => {
  if (!await assertComponentAccess(req, res, req.params.id as string)) return;
  const component = await vesselComponentService.update(req.params.id as string, req.body);
  res.json({ success: true, data: component });
}));

router.delete('/components/:id', authenticate, asyncHandler(async (req, res) => {
  if (!await assertComponentAccess(req, res, req.params.id as string)) return;
  await vesselComponentService.delete(req.params.id as string);
  res.json({ success: true, data: { message: 'Component deleted' } });
}));

// === Sub-Components ===

router.get('/components/:parentId/sub-components', authenticate, asyncHandler(async (req, res) => {
  const subs = await vesselComponentService.listSubComponents(req.params.parentId as string);
  res.json({ success: true, data: subs });
}));

router.post('/components/:parentId/sub-components', authenticate, asyncHandler(async (req, res) => {
  const parent = await vesselComponentService.addSubComponent(req.params.parentId as string, req.body);
  res.status(201).json({ success: true, data: parent });
}));

router.post('/components/:parentId/apply-template', authenticate, asyncHandler(async (req, res) => {
  const result = await vesselComponentService.applyTemplate(req.params.parentId as string, req.body.templateName);
  res.json({ success: true, data: result });
}));

router.put('/components/:parentId/sub-components/reorder', authenticate, asyncHandler(async (req, res) => {
  const subs = await vesselComponentService.reorderSubComponents(req.params.parentId as string, req.body.ordering);
  res.json({ success: true, data: subs });
}));

router.get('/component-templates/:category', authenticate, asyncHandler(async (req, res) => {
  const templates = vesselComponentService.getTemplatesForCategory(req.params.category as string);
  res.json({ success: true, data: templates });
}));

// === Category Field Configuration ===

router.get('/category-config', authenticate, (req: Request, res: Response) => {
  const scale = (req.query.foulingScale as string)?.toUpperCase() as FoulingScale | undefined;
  if (scale && scale !== 'LOF' && scale !== 'FR') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'foulingScale must be LOF or FR' } });
    return;
  }
  if (!scale) {
    res.json({ success: true, data: CATEGORY_FIELD_CONFIG });
    return;
  }
  const scaled: Record<string, any> = {};
  for (const [cat, cfg] of Object.entries(CATEGORY_FIELD_CONFIG)) {
    scaled[cat] = getCategoryConfig(cat, scale);
  }
  res.json({ success: true, data: scaled, foulingScale: scale });
});

router.get('/category-config/:category', authenticate, (req: Request, res: Response) => {
  const scale = (req.query.foulingScale as string)?.toUpperCase() as FoulingScale | undefined;
  if (scale && scale !== 'LOF' && scale !== 'FR') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'foulingScale must be LOF or FR' } });
    return;
  }
  const config = getCategoryConfig(req.params.category as string, scale);
  res.json({ success: true, data: config, foulingScale: scale || null });
});

router.get('/fouling-scale/:scale', authenticate, (req: Request, res: Response) => {
  const scale = (req.params.scale as string).toUpperCase() as FoulingScale;
  if (scale !== 'LOF' && scale !== 'FR') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Scale must be LOF or FR' } });
    return;
  }
  res.json({
    success: true,
    data: {
      scale,
      levels: getScaleLevels(scale),
      range: getFoulingScaleRange(scale),
    },
  });
});

router.get('/pdr-scale', authenticate, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      scale: 'PDR',
      levels: PDR_SCALE,
      range: getPdrScaleRange(),
    },
  });
});

// === GA Zone Mapping ===

router.get('/vessels/:vesselId/components/zone-mappings', authenticate, asyncHandler(async (req, res) => {
  const data = await vesselComponentService.getZoneMappings(req.params.vesselId as string);
  res.json({ success: true, data });
}));

router.get('/vessels/:vesselId/components/by-zone/:gaZoneId', authenticate, asyncHandler(async (req, res) => {
  const components = await vesselComponentService.listByZone(
    req.params.vesselId as string,
    req.params.gaZoneId as string,
  );
  res.json({ success: true, data: components });
}));

router.put('/components/:id/zone', authenticate, asyncHandler(async (req, res) => {
  const { gaZoneId } = req.body;
  if (!gaZoneId || typeof gaZoneId !== 'string') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'gaZoneId is required and must be a string' } });
    return;
  }
  const component = await vesselComponentService.mapToZone(req.params.id as string, gaZoneId);
  res.json({ success: true, data: component });
}));

router.delete('/components/:id/zone', authenticate, asyncHandler(async (req, res) => {
  const component = await vesselComponentService.unmapFromZone(req.params.id as string);
  res.json({ success: true, data: component });
}));

router.put('/vessels/:vesselId/components/zone-mappings', authenticate, asyncHandler(async (req, res) => {
  const { mappings } = req.body;
  if (!Array.isArray(mappings)) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'mappings must be an array of { componentId, gaZoneId }' } });
    return;
  }
  for (const m of mappings) {
    if (!m.componentId || typeof m.componentId !== 'string') {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Each mapping must have a componentId string' } });
      return;
    }
    if (m.gaZoneId !== null && typeof m.gaZoneId !== 'string') {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'gaZoneId must be a string or null' } });
      return;
    }
  }
  const data = await vesselComponentService.bulkMapZones(req.params.vesselId as string, mappings);
  res.json({ success: true, data });
}));

// === ISO 6319:2026 Zone Constants ===

router.get('/iso-zones', authenticate, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      zones: ISO_ZONES,
      hullZones: ISO_HULL_ZONES,
      nicheZones: ISO_NICHE_ZONES,
      visibilityConditions: ISO_VISIBILITY_CONDITIONS,
      afcConditions: ISO_AFC_CONDITIONS,
      mgpsConditions: ISO_MGPS_CONDITIONS,
    },
  });
});

router.post('/iso-zones/suggest', authenticate, (req: Request, res: Response) => {
  const { name, category } = req.body;
  const suggestion = suggestIsoZone(name, category);
  res.json({ success: true, data: { suggestedZone: suggestion } });
});

// === Digital Twin — Fouling State & Work History ===

router.get('/vessels/:vesselId/components/fouling-state', authenticate, asyncHandler(async (req, res) => {
  const data = await workFormService.getFoulingStateByVessel(req.params.vesselId as string);
  res.json({ success: true, data });
}));

router.get('/vessels/:vesselId/components/:componentId/work-history', authenticate, asyncHandler(async (req, res) => {
  const data = await workFormService.getComponentWorkHistory(
    req.params.vesselId as string,
    req.params.componentId as string,
  );
  res.json({ success: true, data });
}));

// === Work Form Entries ===

router.post('/work-orders/:workOrderId/form/generate', authenticate, requireWorkOrderWrite(), asyncHandler(async (req, res) => {
  const entries = await workFormService.generateForm(req.params.workOrderId as string, req.user!.userId);
  res.status(201).json({ success: true, data: entries });
}));

router.get('/work-orders/:workOrderId/form', authenticate, requireWorkOrderView(), asyncHandler(async (req, res) => {
  const entries = await workFormService.getFormEntries(req.params.workOrderId as string);
  res.json({ success: true, data: entries });
}));

router.put('/form-entries/:entryId', authenticate, asyncHandler(async (req, res) => {
  const existing = await prisma.workFormEntry.findUnique({
    where: { id: req.params.entryId as string },
    select: { workOrderId: true },
  });
  if (!existing) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
    return;
  }

  const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
  const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
  const canWrite = canEditByOrg || canWriteAsCollaborator;
  const canView = await workOrderService.canViewWorkOrder(
    existing.workOrderId,
    req.user!.userId,
    req.user!.organisationId,
    canEditByOrg || hasAnyPermission(req.user, 'WORK_ORDER_VIEW'),
  );
  if (!canView) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
    return;
  }
  if (!canWrite) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    return;
  }

  const entry = await workFormService.updateEntry(req.params.entryId as string, req.body, req.user!.userId);
  res.json({ success: true, data: entry });
}));

// PATCH update form entry by workOrderId + entryId (used by frontend persistence layer)
router.patch('/work-orders/:workOrderId/form/entries/:entryId', authenticate, asyncHandler(async (req, res) => {
  const existing = await prisma.workFormEntry.findUnique({
    where: { id: req.params.entryId as string },
    select: { workOrderId: true },
  });
  if (!existing || existing.workOrderId !== req.params.workOrderId) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
    return;
  }

  const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
  const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
  if (!canEditByOrg && !canWriteAsCollaborator) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    return;
  }

  const entry = await workFormService.updateEntry(req.params.entryId as string, req.body, req.user!.userId);
  res.json({ success: true, data: entry });
}));

// Update a single field on a form entry (for real-time collaboration)
router.patch('/form-entries/:entryId/field', authenticate, asyncHandler(async (req, res) => {
  const { field, value } = req.body;
  if (!field) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'field is required' } });
    return;
  }
  const existing = await prisma.workFormEntry.findUnique({
    where: { id: req.params.entryId as string },
    select: { workOrderId: true },
  });
  if (!existing) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
    return;
  }
  const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
  const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
  if (!canEditByOrg && !canWriteAsCollaborator) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    return;
  }
  const entry = await workFormService.updateField(req.params.entryId as string, field, value, req.user!.userId);
  res.json({ success: true, data: entry });
}));

router.post('/form-entries/:entryId/attachments', authenticate, asyncHandler(async (req, res) => {
  const existing = await prisma.workFormEntry.findUnique({
    where: { id: req.params.entryId as string },
    select: { workOrderId: true },
  });
  if (!existing) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
    return;
  }

  const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
  const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
  const canWrite = canEditByOrg || canWriteAsCollaborator;
  if (!canWrite) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    return;
  }

  const entry = await workFormService.addAttachment(req.params.entryId as string, req.body.mediaId);
  res.json({ success: true, data: entry });
}));

router.get('/work-orders/:workOrderId/form/json', authenticate, requireWorkOrderView(), asyncHandler(async (req, res) => {
  const data = await workFormService.getFormDataJson(req.params.workOrderId as string);
  res.json({ success: true, data });
}));

export default router;
