import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import path from 'path';

export const mediaService = {
  async create(file: Express.Multer.File, userId: string, metadata: Record<string, string>) {
    const media = await prisma.media.create({
      data: {
        uploaderId: userId,
        vesselId: metadata.vesselId || null,
        workOrderId: metadata.workOrderId || null,
        inspectionId: metadata.inspectionId || null,
        findingId: metadata.findingId || null,
        submissionId: metadata.submissionId || null,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageKey: file.filename,
        url: `/uploads/${file.filename}`,
        thumbnailUrl: null,
        latitude: metadata.latitude ? parseFloat(metadata.latitude) : null,
        longitude: metadata.longitude ? parseFloat(metadata.longitude) : null,
        tags: metadata.tags || '[]',
      },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'Media',
      entityId: media.id,
      action: 'FILE_UPLOAD',
      description: `Uploaded file "${file.originalname}"`,
    });

    return media;
  },

  async getById(id: string) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');
    return media;
  },

  async delete(id: string, userId: string) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');

    await prisma.media.delete({ where: { id } });

    await auditService.log({
      actorId: userId,
      entityType: 'Media',
      entityId: id,
      action: 'FILE_DELETE',
      description: `Deleted file "${media.originalName}"`,
    });
  },
};
