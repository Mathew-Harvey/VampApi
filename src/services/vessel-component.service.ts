import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { SUB_COMPONENT_TEMPLATES } from '../config/sub-component-templates';

const SUB_COMPONENT_INCLUDE = {
  subComponents: { orderBy: { sortOrder: 'asc' as const } },
};

export const vesselComponentService = {
  /**
   * List top-level components for a vessel, each with its sub-components.
   * Only returns root components (parentId is null).
   */
  async listByVessel(vesselId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId, parentId: null },
      include: SUB_COMPONENT_INCLUDE,
      orderBy: { sortOrder: 'asc' },
    });
  },

  /**
   * Get a single component with its sub-components.
   */
  async getById(id: string) {
    const component = await prisma.vesselComponent.findUnique({
      where: { id },
      include: SUB_COMPONENT_INCLUDE,
    });
    if (!component) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return component;
  },

  /**
   * Create a top-level GA component.
   */
  async create(vesselId: string, data: any) {
    return prisma.vesselComponent.create({
      data: { vesselId, ...data },
      include: SUB_COMPONENT_INCLUDE,
    });
  },

  /**
   * Update a component (top-level or sub-component).
   */
  async update(id: string, data: any) {
    const existing = await prisma.vesselComponent.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return prisma.vesselComponent.update({
      where: { id },
      data,
      include: SUB_COMPONENT_INCLUDE,
    });
  },

  /**
   * Delete a component and all its sub-components (cascade).
   */
  async delete(id: string) {
    await prisma.vesselComponent.delete({ where: { id } });
  },

  /**
   * Bulk-create top-level components.
   */
  async bulkCreate(vesselId: string, components: any[]) {
    return Promise.all(
      components.map((comp, i) =>
        prisma.vesselComponent.create({
          data: { vesselId, sortOrder: i + 1, ...comp },
          include: SUB_COMPONENT_INCLUDE,
        })
      )
    );
  },

  // ── Sub-component operations ────────────────────────────────

  /**
   * Add a single sub-component to a parent GA component.
   */
  async addSubComponent(parentId: string, data: any) {
    const parent = await prisma.vesselComponent.findUnique({ where: { id: parentId } });
    if (!parent) throw new AppError(404, 'NOT_FOUND', 'Parent component not found');
    if (parent.parentId) throw new AppError(400, 'NESTING_NOT_ALLOWED', 'Sub-components cannot have their own sub-components');

    const maxSort = await prisma.vesselComponent.aggregate({
      where: { parentId },
      _max: { sortOrder: true },
    });

    return prisma.vesselComponent.create({
      data: {
        vesselId: parent.vesselId,
        parentId,
        category: parent.category,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        ...data,
      },
    });
  },

  /**
   * List sub-components for a given parent.
   */
  async listSubComponents(parentId: string) {
    return prisma.vesselComponent.findMany({
      where: { parentId },
      orderBy: { sortOrder: 'asc' },
    });
  },

  /**
   * Apply a template to a parent component — bulk-creates sub-components.
   * Existing sub-components are removed first so the template is applied cleanly.
   */
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

    // Remove existing sub-components, then create from template
    await prisma.vesselComponent.deleteMany({ where: { parentId } });

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

    return {
      parent: await prisma.vesselComponent.findUnique({
        where: { id: parentId },
        include: SUB_COMPONENT_INCLUDE,
      }),
      applied: template.templateName,
      count: created.length,
    };
  },

  /**
   * List available templates for a given category.
   */
  getTemplatesForCategory(category: string) {
    const templates = SUB_COMPONENT_TEMPLATES[category];
    if (!templates) return [];
    return templates.map((t) => ({
      templateName: t.templateName,
      subComponentCount: t.subComponents.length,
      subComponentNames: t.subComponents.map((sc) => sc.name),
    }));
  },

  /**
   * Reorder sub-components within a parent.
   * Expects an array of { id, sortOrder } objects.
   */
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

  /**
   * Flat list of ALL components for a vessel (top-level + sub-components).
   * Used internally by work form generation.
   */
  async listAllFlat(vesselId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId },
      orderBy: [{ sortOrder: 'asc' }],
    });
  },
};
