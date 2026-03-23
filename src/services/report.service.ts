import fs from 'fs';
import Handlebars from 'handlebars';
import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { workFormService } from './work-form.service';
import { registerReportHelpers } from '../helpers/report-helpers';
import {
  type ReportConfig,
  getReportConfig,
  mergeReportConfig,
} from './report-helpers';
import {
  resolveInspectionTemplatePath,
  compileAndRender,
  buildPhotoPages,
  buildReportViewerHtml,
  BFMP_TEMPLATE_NAME,
  COMPLIANCE_TEMPLATE_NAME,
  AUDIT_TEMPLATE_NAME,
  WORK_ORDER_TEMPLATE_NAME,
} from './report-templates';
import { buildInspectionReportContext } from './report-context';

export const reportService = {
  async getInspectionReportViewHtml(workOrderId: string, token?: string) {
    return buildReportViewerHtml(workOrderId, 'inspection', 'Inspection Report', token);
  },

  async getReportViewHtml(workOrderId: string, reportType: string = 'inspection', title: string = 'Inspection Report', token?: string) {
    return buildReportViewerHtml(workOrderId, reportType, title, token);
  },

  async getInspectionReportConfig(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      select: { id: true, metadata: true },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    return getReportConfig(workOrder.metadata);
  },

  async updateInspectionReportConfig(workOrderId: string, reportConfig: ReportConfig) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      select: { id: true, metadata: true },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const merged = mergeReportConfig(workOrder.metadata, reportConfig);
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { metadata: JSON.stringify(merged) },
    });
    return getReportConfig(merged);
  },

  async getInspectionReportContext(workOrderId: string) {
    const formData = await workFormService.getFormDataJson(workOrderId);
    const photoPages = buildPhotoPages(formData.entries);
    const context = await buildInspectionReportContext(formData, photoPages);

    return {
      workOrderId,
      templatePath: resolveInspectionTemplatePath(),
      formData,
      photoPages,
      context,
    };
  },

  async generateInspectionReport(workOrderId: string) {
    const formData = await workFormService.getFormDataJson(workOrderId);
    const photoPages = buildPhotoPages(formData.entries);
    const templatePath = resolveInspectionTemplatePath();
    if (!templatePath) return { ...formData, photoPages, html: null };

    const templateSource = fs.readFileSync(templatePath, 'utf-8');

    registerReportHelpers(Handlebars);
    const template = Handlebars.compile(templateSource);
    const context = await buildInspectionReportContext(formData, photoPages);
    const html = template(context);

    return {
      ...formData,
      photoPages,
      html,
    };
  },

  async generateWorkOrderReport(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: {
        vessel: true,
        organisation: true,
        assignments: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        inspections: { include: { findings: true } },
        taskSubmissions: { include: { task: true, user: { select: { firstName: true, lastName: true } } } },
        comments: { include: { author: { select: { firstName: true, lastName: true } } } },
        formEntries: { include: { vesselComponent: true } },
      },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const totalFindings = (workOrder.inspections ?? []).reduce(
      (sum, insp) => sum + (insp.findings?.length ?? 0), 0
    );

    const context: Record<string, any> = {
      reportType: 'work-order',
      generatedAt: new Date().toISOString().slice(0, 10),
      organisation: workOrder.organisation ? { id: workOrder.organisation.id, name: workOrder.organisation.name } : null,
      workOrder: {
        id: workOrder.id,
        referenceNumber: workOrder.referenceNumber,
        title: workOrder.title,
        description: workOrder.description,
        status: workOrder.status,
        type: (workOrder as any).type || null,
        foulingScale: (workOrder as any).foulingScale || null,
        priority: (workOrder as any).priority || null,
        location: (workOrder as any).location || null,
        scheduledStart: workOrder.scheduledStart,
        scheduledEnd: workOrder.scheduledEnd,
        actualStart: (workOrder as any).actualStart || null,
        actualEnd: (workOrder as any).actualEnd || null,
        createdAt: workOrder.createdAt,
        updatedAt: workOrder.updatedAt,
      },
      vessel: workOrder.vessel ? {
        name: workOrder.vessel.name,
        imoNumber: workOrder.vessel.imoNumber,
        vesselType: workOrder.vessel.vesselType,
        flagState: workOrder.vessel.flagState,
        grossTonnage: workOrder.vessel.grossTonnage,
        yearBuilt: workOrder.vessel.yearBuilt,
        lengthOverall: workOrder.vessel.lengthOverall,
        beam: workOrder.vessel.beam,
        maxDraft: workOrder.vessel.maxDraft,
      } : null,
      assignments: (workOrder.assignments ?? []).map((a: any) => ({
        role: a.role || 'Member',
        user: a.user || { firstName: '', lastName: '', email: '' },
      })),
      inspections: (workOrder.inspections ?? []).map((insp: any) => ({
        title: insp.title || 'Inspection',
        status: insp.status,
        type: insp.type,
        createdAt: insp.createdAt,
        findings: (insp.findings ?? []).map((f: any) => ({
          component: f.component || f.location || 'N/A',
          severity: f.severity || 'N/A',
          description: f.description || '',
          recommendation: f.recommendation || '',
        })),
      })),
      formEntries: (workOrder.formEntries ?? []).map((fe: any) => ({
        component: fe.component || '',
        vesselComponent: fe.vesselComponent ? { name: fe.vesselComponent.name } : null,
        foulingRating: fe.foulingRating,
        coverage: fe.coverage,
        coatingCondition: fe.coatingCondition,
        notes: fe.notes,
      })),
      taskSubmissions: (workOrder.taskSubmissions ?? []).map((ts: any) => ({
        task: ts.task ? { title: ts.task.title } : null,
        user: ts.user || null,
        status: ts.status,
        notes: ts.notes,
        createdAt: ts.createdAt,
      })),
      comments: (workOrder.comments ?? []).map((c: any) => ({
        content: c.content,
        author: c.author || null,
        createdAt: c.createdAt,
      })),
      totalFindings,
    };

    const html = compileAndRender(WORK_ORDER_TEMPLATE_NAME, context);
    return { ...context, html };
  },

  async getDocuments(filters: { vesselId?: string; workOrderId?: string } = {}, organisationId?: string) {
    const where: any = {};
    if (filters?.vesselId) where.vesselId = filters.vesselId;
    if (filters?.workOrderId) where.workOrderId = filters.workOrderId;
    if (organisationId) {
      where.OR = [
        { workOrder: { organisationId, isDeleted: false } },
        { vessel: { organisationId, isDeleted: false } },
      ];
    }

    return prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  },

  /* ---------------------------------------------------------------- */
  /*  BFMP Report                                                      */
  /* ---------------------------------------------------------------- */
  async generateBFMPReport(payload: any, organisationId: string) {
    const organisation = await prisma.organisation.findFirst({
      where: { id: organisationId },
      select: { id: true, name: true },
    });

    // If a vesselId is provided, enrich with vessel data from DB
    let vesselData: any = null;
    if (payload.vesselId) {
      vesselData = await prisma.vessel.findFirst({
        where: { id: payload.vesselId, organisationId, isDeleted: false },
        select: {
          id: true, name: true, imoNumber: true, vesselType: true,
          grossTonnage: true, yearBuilt: true, lengthOverall: true,
          beam: true, maxDraft: true, flagState: true, callSign: true,
          homePort: true,
        },
      });
    }

    const context: Record<string, any> = {
      reportType: 'bfmp',
      generatedAt: new Date().toISOString(),
      organisation: organisation ? { id: organisation.id, name: organisation.name } : null,
      planInformation: {
        reference: payload.planReference || null,
        revision: payload.revision || '1',
        date: payload.planDate || null,
        preparedBy: payload.preparedBy || null,
        approvedBy: payload.approvedBy || null,
        approvalDate: payload.approvalDate || null,
      },
      vessel: vesselData ? {
        ...vesselData,
        flagState: payload.flagState || vesselData.flagState,
        portOfRegistry: payload.portOfRegistry || vesselData.homePort,
        callSign: payload.callSign || vesselData.callSign,
      } : {
        name: payload.vesselName,
        imoNumber: payload.imoNumber,
        flagState: payload.flagState,
        portOfRegistry: payload.portOfRegistry,
        shipType: payload.shipType,
        grossTonnage: payload.grossTonnage,
        yearBuilt: payload.yearBuilt,
        lengthOverall: payload.lengthOverall,
        beam: payload.beam,
        maxDraft: payload.maxDraft,
        callSign: payload.callSign,
      },
      company: {
        name: payload.companyName || organisation?.name || null,
        address: payload.companyAddress || null,
        ismContact: {
          name: payload.ismContactName || null,
          email: payload.ismContactEmail || null,
          phone: payload.ismContactPhone || null,
        },
        designatedPerson: payload.designatedPerson || null,
      },
      antiFoulingSystem: {
        hull: {
          type: payload.hullAfsType || null,
          manufacturer: payload.hullCoatingManufacturer || null,
          product: payload.hullCoatingProduct || null,
          applicationDate: payload.hullApplicationDate || null,
          recoatingDate: payload.hullRecoatingDate || null,
        },
        lastDryDock: payload.lastDryDockDate || null,
        nextDryDock: payload.nextDryDockDate || null,
        nicheAreas: Array.isArray(payload.nicheAreas) ? payload.nicheAreas : [],
      },
      operatingProfile: {
        tradeRoutes: payload.tradeRoutes || null,
        typicalVoyageDuration: payload.typicalVoyageDuration || null,
        typicalPortStay: payload.typicalPortStay || null,
        waterTempRange: payload.waterTempRange || null,
        typicalSpeed: payload.typicalSpeed || null,
        percentTimeAtAnchor: payload.percentTimeAtAnchor || null,
        layUpPeriods: payload.layUpPeriods || null,
      },
      riskAssessment: {
        operatingProfileRisk: payload.operatingProfileRisk || null,
        nicheAreaRisk: payload.nicheAreaRisk || null,
        hullCoatingRisk: payload.hullCoatingRisk || null,
        overallRisk: payload.overallRisk || null,
        notes: payload.riskNotes || null,
      },
      inspectionSchedule: {
        frequency: payload.inspectionFrequency || null,
        lastInspection: payload.lastInspectionDate || null,
        nextInspectionDue: payload.nextInspectionDue || null,
        triggerConditions: payload.triggerConditions || null,
        records: Array.isArray(payload.inspectionRecords) ? payload.inspectionRecords : [],
      },
      maintenance: {
        cleaningMethod: payload.cleaningMethod || null,
        approvedContractors: payload.approvedContractors || null,
        captureRequirements: payload.captureRequirements || null,
        records: Array.isArray(payload.maintenanceRecords) ? payload.maintenanceRecords : [],
      },
      contingency: {
        foulingThreshold: payload.foulingThreshold || null,
        emergencyResponse: payload.emergencyResponse || null,
        portStateNotification: payload.portStateNotification || null,
        notes: payload.contingencyNotes || null,
      },
    };

    const html = compileAndRender(BFMP_TEMPLATE_NAME, context);
    return { ...context, html };
  },

  async saveBFMPDraft(payload: any, organisationId: string, userId: string) {
    // Store draft in a document record for later retrieval
    const doc = await prisma.document.create({
      data: {
        name: `BFMP Draft - ${payload.vesselName || 'Untitled'} - ${new Date().toISOString().slice(0, 10)}`,
        type: 'BFMP_DRAFT',
        version: 1,
        storageKey: `bfmp-drafts/${organisationId}/${Date.now()}.json`,
        url: '',
        size: JSON.stringify(payload).length,
        mimeType: 'application/json',
        generatedFrom: JSON.stringify({ type: 'bfmp-draft', userId, payload }),
        ...(payload.vesselId ? { vesselId: payload.vesselId } : {}),
      },
    });
    return { id: doc.id, savedAt: doc.createdAt };
  },

  /* ---------------------------------------------------------------- */
  /*  Compliance Summary Report                                        */
  /* ---------------------------------------------------------------- */
  async generateComplianceReport(payload: any, organisationId: string) {
    const organisation = await prisma.organisation.findFirst({
      where: { id: organisationId },
      select: { id: true, name: true },
    });

    // Fetch vessels for the organisation
    const vesselWhere: any = { organisationId, isDeleted: false };
    if (Array.isArray(payload.vesselIds) && payload.vesselIds.length > 0 && !payload.selectAllVessels) {
      vesselWhere.id = { in: payload.vesselIds };
    }
    const vessels = await prisma.vessel.findMany({
      where: vesselWhere,
      select: {
        id: true, name: true, imoNumber: true, vesselType: true, flagState: true,
      },
      orderBy: { name: 'asc' },
    });

    // Fetch recent work orders for inspection compliance
    const workOrders = await prisma.workOrder.findMany({
      where: {
        organisationId,
        isDeleted: false,
        ...(payload.startDate ? { createdAt: { gte: new Date(payload.startDate) } } : {}),
      },
      select: {
        id: true, referenceNumber: true, title: true, status: true, type: true,
        vesselId: true, scheduledStart: true, scheduledEnd: true, actualStart: true,
        actualEnd: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Build per-vessel compliance summary
    const vesselSummaries = vessels.map((vessel) => {
      const vesselWorkOrders = workOrders.filter((wo) => wo.vesselId === vessel.id);
      const completedCount = vesselWorkOrders.filter((wo) => wo.status === 'COMPLETED').length;
      const overdueCount = vesselWorkOrders.filter((wo) =>
        wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && wo.scheduledEnd && new Date(wo.scheduledEnd) < new Date()
      ).length;

      return {
        vessel: { id: vessel.id, name: vessel.name, imoNumber: vessel.imoNumber, flagState: vessel.flagState },
        totalWorkOrders: vesselWorkOrders.length,
        completedWorkOrders: completedCount,
        overdueWorkOrders: overdueCount,
        complianceRate: vesselWorkOrders.length > 0
          ? Math.round((completedCount / vesselWorkOrders.length) * 100)
          : null,
      };
    });

    const context: Record<string, any> = {
      reportType: 'compliance',
      generatedAt: new Date().toISOString(),
      organisation: organisation ? { id: organisation.id, name: organisation.name } : null,
      reportDetails: {
        title: payload.reportTitle || 'Fleet Compliance Summary',
        preparedBy: payload.preparedBy || null,
        reportDate: payload.reportDate || new Date().toISOString().slice(0, 10),
        period: { start: payload.startDate, end: payload.endDate },
        exportFormat: payload.exportFormat || 'PDF',
      },
      filters: {
        categories: payload.selectedCategories || [],
        statusFilter: payload.statusFilter || 'All',
        includeOverdue: payload.includeOverdue ?? true,
        includeUpcoming: payload.includeUpcoming ?? true,
        upcomingDays: parseInt(payload.upcomingDays || '30', 10),
      },
      fleetOverview: {
        totalVessels: vessels.length,
        totalWorkOrders: workOrders.length,
        completedWorkOrders: workOrders.filter((wo) => wo.status === 'COMPLETED').length,
        overdueWorkOrders: workOrders.filter((wo) =>
          wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && wo.scheduledEnd && new Date(wo.scheduledEnd) < new Date()
        ).length,
      },
      vesselSummaries,
      additionalNotes: payload.additionalNotes || null,
    };

    const html = compileAndRender(COMPLIANCE_TEMPLATE_NAME, context);
    return { ...context, html };
  },

  /* ---------------------------------------------------------------- */
  /*  Audit Report                                                     */
  /* ---------------------------------------------------------------- */
  async generateAuditReport(payload: any, organisationId: string) {
    const organisation = await prisma.organisation.findFirst({
      where: { id: organisationId },
      select: { id: true, name: true },
    });

    // Build audit log query filters
    const auditWhere: any = { organisationId };
    if (payload.startDate) {
      auditWhere.createdAt = { ...(auditWhere.createdAt || {}), gte: new Date(payload.startDate) };
    }
    if (payload.endDate) {
      auditWhere.createdAt = { ...(auditWhere.createdAt || {}), lte: new Date(payload.endDate + 'T23:59:59.999Z') };
    }
    if (payload.filterByVessel && payload.vesselId) {
      auditWhere.entityId = payload.vesselId;
    }
    if (payload.filterByUser && payload.userId) {
      auditWhere.userId = payload.userId;
    }

    const maxResults = Math.min(parseInt(payload.maxResults || '1000', 10), 5000);

    // Attempt to read audit logs - if the AuditLog model exists
    let auditEntries: any[] = [];
    try {
      auditEntries = await (prisma as any).auditLog.findMany({
        where: auditWhere,
        orderBy: { createdAt: 'desc' },
        take: maxResults,
      });
    } catch {
      // AuditLog model may not exist yet; return structured empty report
      // Fall back to aggregating from work orders, inspections, etc.
      const workOrders = await prisma.workOrder.findMany({
        where: {
          organisationId,
          isDeleted: false,
          ...(payload.startDate ? { updatedAt: { gte: new Date(payload.startDate) } } : {}),
          ...(payload.endDate ? { updatedAt: { lte: new Date(payload.endDate + 'T23:59:59.999Z') } } : {}),
        },
        select: {
          id: true, referenceNumber: true, title: true, status: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: maxResults,
      });

      auditEntries = workOrders.map((wo) => ({
        id: wo.id,
        entityType: 'WorkOrder',
        entityId: wo.id,
        action: 'updated',
        description: `Work Order ${wo.referenceNumber} - ${wo.title} (${wo.status})`,
        timestamp: wo.updatedAt,
      }));
    }

    // Group results based on payload.grouping
    let groupedEntries: any;
    if (payload.grouping === 'By Entity') {
      groupedEntries = {};
      for (const entry of auditEntries) {
        const key = entry.entityType || 'Unknown';
        if (!groupedEntries[key]) groupedEntries[key] = [];
        groupedEntries[key].push(entry);
      }
    } else if (payload.grouping === 'By User') {
      groupedEntries = {};
      for (const entry of auditEntries) {
        const key = entry.userId || entry.user || 'System';
        if (!groupedEntries[key]) groupedEntries[key] = [];
        groupedEntries[key].push(entry);
      }
    } else if (payload.grouping === 'By Event Type') {
      groupedEntries = {};
      for (const entry of auditEntries) {
        const key = entry.action || entry.eventType || 'Unknown';
        if (!groupedEntries[key]) groupedEntries[key] = [];
        groupedEntries[key].push(entry);
      }
    } else {
      groupedEntries = auditEntries;
    }

    const isGrouped = payload.grouping && payload.grouping !== 'Chronological';
    const context: Record<string, any> = {
      reportType: 'audit',
      generatedAt: new Date().toISOString(),
      organisation: organisation ? { id: organisation.id, name: organisation.name } : null,
      reportDetails: {
        title: payload.reportTitle || 'Audit Trail Report',
        preparedBy: payload.preparedBy || null,
        reportDate: payload.reportDate || new Date().toISOString().slice(0, 10),
        period: { start: payload.startDate, end: payload.endDate },
        exportFormat: payload.exportFormat || 'PDF',
      },
      scope: {
        eventTypes: payload.selectedEventTypes || [],
        detailLevel: payload.detailLevel || 'Standard',
        grouping: payload.grouping || 'Chronological',
        filters: {
          vessel: payload.filterByVessel ? payload.vesselId : null,
          workOrder: payload.filterByWorkOrder ? payload.workOrderId : null,
          user: payload.filterByUser ? payload.userId : null,
        },
      },
      summary: {
        totalEvents: auditEntries.length,
        maxResultsApplied: auditEntries.length >= maxResults,
      },
      isGrouped,
      entries: groupedEntries,
      additionalNotes: payload.additionalNotes || null,
    };

    const html = compileAndRender(AUDIT_TEMPLATE_NAME, context);
    return { ...context, html };
  },
};
