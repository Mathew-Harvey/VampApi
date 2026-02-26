import prisma from '../config/database';
import { AppError } from '../middleware/error';

export const vesselComponentService = {
  async listByVessel(vesselId: string) {
    return prisma.vesselComponent.findMany({
      where: { vesselId },
      orderBy: { sortOrder: 'asc' },
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
};
