import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { SUB_COMPONENT_TEMPLATES } from '../config/sub-component-templates';

const CHILDREN_INCLUDE = {
  children: { orderBy: { sortOrder: 'asc' as const } },
};

export const vesselComponentService = {
  async listByVessel(vesselId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId, parentId: null },
      include: CHILDREN_INCLUDE,
      orderBy: { sortOrder: 'asc' },
    });
  },

  async getById(id: string) {
    const component = await prisma.vesselComponent.findUnique({
      where: { id },
      include: CHILDREN_INCLUDE,
    });
    if (!component) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return component;
  },

  async create(vesselId: string, data: any) {
    return prisma.vesselComponent.create({
      data: { vesselId, ...data },
      include: CHILDREN_INCLUDE,
    });
  },

  async update(id: string, data: any) {
    const existing = await prisma.vesselComponent.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return prisma.vesselComponent.update({
      where: { id },
      data,
      include: CHILDREN_INCLUDE,
    });
  },

  async delete(id: string) {
    const children = await prisma.vesselComponent.findMany({ where: { parentId: id }, select: { id: true } });
    const idsToRemove = [id, ...children.map((c) => c.id)];
    await prisma.workFormEntry.deleteMany({ where: { vesselComponentId: { in: idsToRemove } } });
    await prisma.vesselComponent.delete({ where: { id } });
  },

  async bulkCreate(vesselId: string, components: any[]) {
    return Promise.all(
      components.map((comp, i) =>
        prisma.vesselComponent.create({
          data: { vesselId, sortOrder: i + 1, ...comp },
          include: CHILDREN_INCLUDE,
        })
      )
    );
  },

  // ── Sub-component operations ────────────────────────────────

  async addSubComponent(parentId: string, data: any) {
    const parent = await prisma.vesselComponent.findUnique({ where: { id: parentId } });
    if (!parent) throw new AppError(404, 'NOT_FOUND', 'Parent component not found');
    if (parent.parentId) throw new AppError(400, 'NESTING_NOT_ALLOWED', 'Sub-components cannot have their own sub-components');

    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Sub-component name is required');
    }

    const maxSort = await prisma.vesselComponent.aggregate({
      where: { parentId },
      _max: { sortOrder: true },
    });

    const subComponent = await prisma.vesselComponent.create({
      data: {
        name: data.name.trim(),
        vessel: { connect: { id: parent.vesselId } },
        parent: { connect: { id: parentId } },
        category: parent.category,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        location: data.location ?? null,
        description: data.description ?? null,
        coatingType: data.coatingType ?? null,
        material: data.material ?? null,
        metadata: data.metadata ?? null,
      },
    });

    // Auto-create work form entries for any active work orders on this vessel
    const activeWorkOrders = await prisma.workOrder.findMany({
      where: {
        vesselId: parent.vesselId,
        isDeleted: false,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'UNDER_REVIEW'] },
        formEntries: { some: {} },
      },
      select: { id: true },
    });

    if (activeWorkOrders.length > 0) {
      await Promise.all(
        activeWorkOrders.map((wo) =>
          prisma.workFormEntry.upsert({
            where: { workOrderId_vesselComponentId: { workOrderId: wo.id, vesselComponentId: subComponent.id } },
            create: { workOrderId: wo.id, vesselComponentId: subComponent.id, status: 'PENDING' },
            update: {},
          })
        )
      );
    }

    return prisma.vesselComponent.findUnique({
      where: { id: parentId },
      include: CHILDREN_INCLUDE,
    });
  },

  async listSubComponents(parentId: string) {
    return prisma.vesselComponent.findMany({
      where: { parentId },
      orderBy: { sortOrder: 'asc' },
    });
  },

  async applyTemplate(parentId: string, templateName: string) {
    const parent = await prisma.vesselComponent.findUnique({ where: { id: parentId } });
    if (!parent) throw new AppError(404, 'NOT_FOUND', 'Parent component not found');
    if (parent.parentId) throw new AppError(400, 'NESTING_NOT_ALLOWED', 'Cannot apply a template to a sub-component');

    const categoryTemplates = SUB_COMPONENT_TEMPLATES[parent.category];
    if (!categoryTemplates || categoryTemplates.length === 0) {
      throw new AppError(400, 'NO_TEMPLATES', `No sub-component templates defined for category "${parent.category}"`);
    }

    const template = categoryTemplates.find((t) => t.templateName === templateName);
    if (!template) {
      const available = categoryTemplates.map((t) => t.templateName).join(', ');
      throw new AppError(400, 'TEMPLATE_NOT_FOUND', `Template "${templateName}" not found. Available: ${available}`);
    }

    const oldSubIds = (await prisma.vesselComponent.findMany({
      where: { parentId },
      select: { id: true },
    })).map((c) => c.id);

    if (oldSubIds.length > 0) {
      await prisma.workFormEntry.deleteMany({ where: { vesselComponentId: { in: oldSubIds } } });
      await prisma.vesselComponent.deleteMany({ where: { parentId } });
    }

    const created = await Promise.all(
      template.subComponents.map((sc, i) =>
        prisma.vesselComponent.create({
          data: {
            vesselId: parent.vesselId,
            parentId,
            name: sc.name,
            category: parent.category,
            description: sc.description ?? null,
            material: sc.material ?? null,
            coatingType: sc.coatingType ?? null,
            sortOrder: i + 1,
          },
        })
      )
    );

    // Auto-create work form entries for active work orders
    const activeWorkOrders = await prisma.workOrder.findMany({
      where: {
        vesselId: parent.vesselId,
        isDeleted: false,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'UNDER_REVIEW'] },
        formEntries: { some: {} },
      },
      select: { id: true },
    });

    if (activeWorkOrders.length > 0) {
      await Promise.all(
        activeWorkOrders.flatMap((wo) =>
          created.map((sc) =>
            prisma.workFormEntry.upsert({
              where: { workOrderId_vesselComponentId: { workOrderId: wo.id, vesselComponentId: sc.id } },
              create: { workOrderId: wo.id, vesselComponentId: sc.id, status: 'PENDING' },
              update: {},
            })
          )
        )
      );
    }

    return {
      parent: await prisma.vesselComponent.findUnique({
        where: { id: parentId },
        include: CHILDREN_INCLUDE,
      }),
      applied: template.templateName,
      count: created.length,
    };
  },

  getTemplatesForCategory(category: string) {
    const templates = SUB_COMPONENT_TEMPLATES[category];
    if (!templates) return [];
    return templates.map((t) => ({
      templateName: t.templateName,
      subComponentCount: t.subComponents.length,
      subComponentNames: t.subComponents.map((sc) => sc.name),
    }));
  },

  async reorderSubComponents(parentId: string, ordering: { id: string; sortOrder: number }[]) {
    const parent = await prisma.vesselComponent.findUnique({ where: { id: parentId } });
    if (!parent) throw new AppError(404, 'NOT_FOUND', 'Parent component not found');

    await Promise.all(
      ordering.map(({ id, sortOrder }) =>
        prisma.vesselComponent.update({
          where: { id },
          data: { sortOrder },
        })
      )
    );

    return prisma.vesselComponent.findMany({
      where: { parentId },
      orderBy: { sortOrder: 'asc' },
    });
  },

  async listAllFlat(vesselId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId },
      orderBy: [{ sortOrder: 'asc' }],
    });
  },

  // ── GA Zone Mapping operations ──────────────────────────────

  async mapToZone(componentId: string, gaZoneId: string) {
    const existing = await prisma.vesselComponent.findUnique({ where: { id: componentId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return prisma.vesselComponent.update({
      where: { id: componentId },
      data: { gaZoneId },
    });
  },

  async unmapFromZone(componentId: string) {
    const existing = await prisma.vesselComponent.findUnique({ where: { id: componentId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return prisma.vesselComponent.update({
      where: { id: componentId },
      data: { gaZoneId: null },
    });
  },

  async bulkMapZones(vesselId: string, mappings: { componentId: string; gaZoneId: string | null }[]) {
    await prisma.$transaction(
      mappings.map(({ componentId, gaZoneId }) =>
        prisma.vesselComponent.update({
          where: { id: componentId },
          data: { gaZoneId },
        })
      )
    );

    return this.getZoneMappings(vesselId);
  },

  async listByZone(vesselId: string, gaZoneId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId, gaZoneId },
      orderBy: { sortOrder: 'asc' },
    });
  },

  async getZoneMappings(vesselId: string) {
    const components = await prisma.vesselComponent.findMany({
      where: { vesselId },
      select: { id: true, name: true, category: true, gaZoneId: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    const mapped = components.filter((c) => c.gaZoneId);
    const unmapped = components.filter((c) => !c.gaZoneId);

    const byZone: Record<string, typeof components> = {};
    for (const comp of mapped) {
      const zone = comp.gaZoneId!;
      if (!byZone[zone]) byZone[zone] = [];
      byZone[zone].push(comp);
    }

    return { mapped, unmapped, byZone };
  },
};
