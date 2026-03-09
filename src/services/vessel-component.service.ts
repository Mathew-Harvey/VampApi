import prisma from '../config/database';
import { AppError } from '../middleware/error';

export const vesselComponentService = {
  async listByVessel(vesselId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId },
      orderBy: { sortOrder: 'asc' },
      include: { children: { orderBy: { sortOrder: 'asc' } } },
    });
  },

  async create(vesselId: string, data: any) {
    return prisma.vesselComponent.create({
      data: { vesselId, ...data },
    });
  },

  async update(id: string, data: any) {
    const existing = await prisma.vesselComponent.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Component not found');
    return prisma.vesselComponent.update({ where: { id }, data });
  },

  async delete(id: string) {
    await prisma.vesselComponent.delete({ where: { id } });
  },

  async bulkCreate(vesselId: string, components: any[]) {
    return Promise.all(
      components.map((comp, i) =>
        prisma.vesselComponent.create({
          data: { vesselId, sortOrder: i + 1, ...comp },
        })
      )
    );
  },

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
