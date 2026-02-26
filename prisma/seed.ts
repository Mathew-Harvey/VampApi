import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create Franmarine organisation
  const franmarine = await prisma.organisation.upsert({
    where: { id: 'org-franmarine' },
    update: {},
    create: {
      id: 'org-franmarine',
      name: 'Franmarine Underwater Services',
      type: 'SERVICE_PROVIDER',
      abn: '12345678901',
      contactEmail: 'admin@franmarine.com.au',
      contactPhone: '+61 8 9000 0000',
      address: 'Henderson, Western Australia',
    },
  });
  console.log('Created organisation:', franmarine.name);

  // 2. Create sample client org
  const svitzer = await prisma.organisation.upsert({
    where: { id: 'org-svitzer' },
    update: {},
    create: {
      id: 'org-svitzer',
      name: 'Svitzer Australia',
      type: 'VESSEL_OPERATOR',
      contactEmail: 'ops@svitzer.com.au',
    },
  });

  // 3. Create admin user
  const passwordHash = await bcrypt.hash('changeme123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'mharvey@marinestream.com.au' },
    update: {},
    create: {
      email: 'mharvey@marinestream.com.au',
      passwordHash,
      firstName: 'Mat',
      lastName: 'Harvey',
      phone: '+61 400 000 000',
    },
  });

  await prisma.organisationUser.upsert({
    where: { userId_organisationId: { userId: admin.id, organisationId: franmarine.id } },
    update: {},
    create: {
      userId: admin.id,
      organisationId: franmarine.id,
      role: 'ECOSYSTEM_ADMIN',
      permissions: JSON.stringify(['ADMIN_FULL_ACCESS']),
      isDefault: true,
    },
  });
  console.log('Created admin user:', admin.email);

  // 4. Create demo users
  const manager = await prisma.user.upsert({
    where: { email: 'manager@franmarine.com.au' },
    update: {},
    create: {
      email: 'manager@franmarine.com.au',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Chen',
    },
  });

  await prisma.organisationUser.upsert({
    where: { userId_organisationId: { userId: manager.id, organisationId: franmarine.id } },
    update: {},
    create: {
      userId: manager.id,
      organisationId: franmarine.id,
      role: 'MANAGER',
      permissions: JSON.stringify([
        'VESSEL_VIEW', 'VESSEL_EDIT',
        'WORK_ORDER_CREATE', 'WORK_ORDER_EDIT', 'WORK_ORDER_ASSIGN', 'WORK_ORDER_APPROVE', 'WORK_ORDER_VIEW',
        'INSPECTION_CREATE', 'INSPECTION_EDIT', 'INSPECTION_APPROVE', 'INSPECTION_VIEW',
        'REPORT_GENERATE', 'REPORT_VIEW', 'USER_INVITE',
      ]),
      isDefault: true,
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: 'operator@franmarine.com.au' },
    update: {},
    create: {
      email: 'operator@franmarine.com.au',
      passwordHash,
      firstName: 'James',
      lastName: 'Wilson',
    },
  });

  await prisma.organisationUser.upsert({
    where: { userId_organisationId: { userId: operator.id, organisationId: franmarine.id } },
    update: {},
    create: {
      userId: operator.id,
      organisationId: franmarine.id,
      role: 'OPERATOR',
      permissions: JSON.stringify(['VESSEL_VIEW', 'WORK_ORDER_VIEW', 'INSPECTION_CREATE', 'INSPECTION_EDIT', 'INSPECTION_VIEW', 'REPORT_VIEW']),
      isDefault: true,
    },
  });

  // 5. Create demo vessels
  const vessels = await Promise.all([
    prisma.vessel.create({
      data: {
        organisationId: franmarine.id,
        name: 'Svitzer Dorado',
        vesselType: 'TUG',
        imoNumber: '9876543',
        flagState: 'Australia',
        homePort: 'Fremantle',
        status: 'ACTIVE',
        complianceStatus: 'COMPLIANT',
        grossTonnage: 450,
        lengthOverall: 32.5,
        yearBuilt: 2015,
        afsCoatingType: 'Biocidal',
        afsManufacturer: 'Jotun',
        afsProductName: 'SeaQuantum X200',
        afsServiceLife: 60,
      },
    }),
    prisma.vessel.create({
      data: {
        organisationId: franmarine.id,
        name: 'HMAS Anzac',
        vesselType: 'NAVAL_FRIGATE',
        flagState: 'Australia',
        homePort: 'Fleet Base West',
        status: 'ACTIVE',
        complianceStatus: 'DUE_FOR_INSPECTION',
        grossTonnage: 3600,
        lengthOverall: 118,
        yearBuilt: 1996,
      },
    }),
    prisma.vessel.create({
      data: {
        organisationId: franmarine.id,
        name: 'Cape Leeuwin Beacon',
        vesselType: 'NAVIGATION_AID',
        homePort: 'Cape Leeuwin',
        status: 'ACTIVE',
        complianceStatus: 'COMPLIANT',
      },
    }),
  ]);
  console.log('Created', vessels.length, 'demo vessels');

  // 6. Create niche areas for first vessel
  await Promise.all([
    prisma.nicheArea.create({ data: { vesselId: vessels[0].id, name: 'Sea Chest Port', location: 'Port side, below waterline' } }),
    prisma.nicheArea.create({ data: { vesselId: vessels[0].id, name: 'Sea Chest Starboard', location: 'Starboard side, below waterline' } }),
    prisma.nicheArea.create({ data: { vesselId: vessels[0].id, name: 'Bow Thruster', location: 'Forward' } }),
    prisma.nicheArea.create({ data: { vesselId: vessels[0].id, name: 'Rudder', location: 'Stern' } }),
    prisma.nicheArea.create({ data: { vesselId: vessels[0].id, name: 'Propeller', location: 'Stern, below waterline' } }),
  ]);

  // 6b. Create vessel components (General Arrangement - underwater digital twin)
  const componentCategories = [
    { name: 'Hull - Flat Bottom', category: 'HULL', location: 'Flat bottom section', sortOrder: 1 },
    { name: 'Hull - Boot Top Port', category: 'HULL', location: 'Port side boot top', sortOrder: 2 },
    { name: 'Hull - Boot Top Starboard', category: 'HULL', location: 'Starboard side boot top', sortOrder: 3 },
    { name: 'Hull - Vertical Side Port', category: 'HULL', location: 'Port side below waterline', sortOrder: 4 },
    { name: 'Hull - Vertical Side Starboard', category: 'HULL', location: 'Starboard side below waterline', sortOrder: 5 },
    { name: 'Sea Chest - Port', category: 'SEA_CHEST', location: 'Port side engine room', sortOrder: 6 },
    { name: 'Sea Chest - Starboard', category: 'SEA_CHEST', location: 'Starboard side engine room', sortOrder: 7 },
    { name: 'Bow Thruster', category: 'THRUSTER', location: 'Forward below waterline', sortOrder: 8 },
    { name: 'Propeller - Port', category: 'PROPELLER', location: 'Port stern', sortOrder: 9 },
    { name: 'Propeller - Starboard', category: 'PROPELLER', location: 'Starboard stern', sortOrder: 10 },
    { name: 'Rudder - Port', category: 'RUDDER', location: 'Port stern', sortOrder: 11 },
    { name: 'Rudder - Starboard', category: 'RUDDER', location: 'Starboard stern', sortOrder: 12 },
    { name: 'Keel', category: 'KEEL', location: 'Centreline bottom', sortOrder: 13 },
    { name: 'Bilge Keel - Port', category: 'KEEL', location: 'Port side turn of bilge', sortOrder: 14 },
    { name: 'Bilge Keel - Starboard', category: 'KEEL', location: 'Starboard side turn of bilge', sortOrder: 15 },
    { name: 'Cathodic Protection Anodes', category: 'ANODES', location: 'Various hull positions', sortOrder: 16 },
    { name: 'Echo Sounder Transducer', category: 'INTAKE', location: 'Forward bottom', sortOrder: 17 },
    { name: 'Speed Log Transducer', category: 'INTAKE', location: 'Forward bottom', sortOrder: 18 },
  ];

  await Promise.all(
    componentCategories.map((comp) =>
      prisma.vesselComponent.create({
        data: { vesselId: vessels[0].id, ...comp },
      })
    )
  );
  console.log('Created', componentCategories.length, 'vessel components');

  // 7. Create workflow templates
  const bioInspectionWF = await prisma.workflow.create({
    data: {
      name: 'Biofouling Inspection',
      description: 'Standard biofouling inspection workflow with review and report generation',
      isTemplate: true,
      isActive: true,
      steps: {
        create: [
          {
            name: 'Pre-Inspection Planning',
            order: 1,
            type: 'DATA_CAPTURE',
            requiredRole: 'OPERATOR',
            tasks: {
              create: [
                { name: 'Pre-inspection checklist', order: 1, taskType: 'CHECKLIST', isRequired: true },
                { name: 'Upload vessel documents', order: 2, taskType: 'FILE_UPLOAD', isRequired: false },
              ],
            },
          },
          {
            name: 'Field Inspection',
            order: 2,
            type: 'DATA_CAPTURE',
            requiredRole: 'OPERATOR',
            tasks: {
              create: [
                { name: 'Record inspection findings', order: 1, taskType: 'INSPECTION_RECORD', isRequired: true },
                { name: 'Capture photos', order: 2, taskType: 'PHOTO_CAPTURE', isRequired: true },
                { name: 'Inspector notes', order: 3, taskType: 'NOTE', isRequired: false },
              ],
            },
          },
          {
            name: 'Review',
            order: 3,
            type: 'PARALLEL_REVIEW',
            requiredRole: 'MANAGER',
            tasks: {
              create: [
                { name: 'Manager approval', order: 1, taskType: 'APPROVAL', isRequired: true },
              ],
            },
          },
          {
            name: 'Report Generation',
            order: 4,
            type: 'REPORT_GENERATION',
            autoAdvance: true,
            tasks: {
              create: [
                { name: 'Generate inspection report', order: 1, taskType: 'NOTE', isRequired: true },
              ],
            },
          },
          {
            name: 'Final Approval',
            order: 5,
            type: 'REVIEW',
            requiredRole: 'MANAGER',
            tasks: {
              create: [
                { name: 'Final sign-off', order: 1, taskType: 'SIGNATURE', isRequired: true },
              ],
            },
          },
        ],
      },
    },
  });

  const hullCleaningWF = await prisma.workflow.create({
    data: {
      name: 'Hull Cleaning',
      description: 'Hull cleaning with pre/post inspection and environmental compliance',
      isTemplate: true,
      isActive: true,
      steps: {
        create: [
          {
            name: 'Pre-Clean Inspection',
            order: 1,
            type: 'DATA_CAPTURE',
            requiredRole: 'OPERATOR',
            tasks: {
              create: [
                { name: 'Record pre-clean condition', order: 1, taskType: 'INSPECTION_RECORD', isRequired: true },
                { name: 'Take before photos', order: 2, taskType: 'PHOTO_CAPTURE', isRequired: true },
              ],
            },
          },
          {
            name: 'Cleaning Execution',
            order: 2,
            type: 'DATA_CAPTURE',
            requiredRole: 'OPERATOR',
            tasks: {
              create: [
                { name: 'Record cleaning activities', order: 1, taskType: 'FORM_FILL', isRequired: true },
              ],
            },
          },
          {
            name: 'Post-Clean Inspection',
            order: 3,
            type: 'DATA_CAPTURE',
            requiredRole: 'OPERATOR',
            tasks: {
              create: [
                { name: 'Record post-clean condition', order: 1, taskType: 'INSPECTION_RECORD', isRequired: true },
                { name: 'Take after photos', order: 2, taskType: 'PHOTO_CAPTURE', isRequired: true },
              ],
            },
          },
          {
            name: 'Environmental Compliance Check',
            order: 4,
            type: 'REVIEW',
            requiredRole: 'MANAGER',
            tasks: {
              create: [
                { name: 'Environmental compliance approval', order: 1, taskType: 'APPROVAL', isRequired: true },
              ],
            },
          },
          {
            name: 'Report Generation',
            order: 5,
            type: 'REPORT_GENERATION',
            autoAdvance: true,
            tasks: {
              create: [
                { name: 'Generate cleaning report', order: 1, taskType: 'NOTE', isRequired: true },
              ],
            },
          },
          {
            name: 'Client Sign-off',
            order: 6,
            type: 'PARALLEL_REVIEW',
            tasks: {
              create: [
                { name: 'Client approval', order: 1, taskType: 'SIGNATURE', isRequired: true },
              ],
            },
          },
        ],
      },
    },
  });

  console.log('Created workflow templates:', bioInspectionWF.name, ',', hullCleaningWF.name);

  // 8. Create a demo work order
  const demoWO = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260210-0001',
      vesselId: vessels[0].id,
      organisationId: franmarine.id,
      workflowId: bioInspectionWF.id,
      title: 'Biofouling Inspection - Svitzer Dorado',
      description: 'Scheduled underwater biofouling inspection of hull and niche areas',
      type: 'BIOFOULING_INSPECTION',
      priority: 'NORMAL',
      status: 'IN_PROGRESS',
      location: 'Fremantle Inner Harbour',
      latitude: -32.0569,
      longitude: 115.7411,
      scheduledStart: new Date('2026-02-15'),
      scheduledEnd: new Date('2026-02-16'),
      actualStart: new Date('2026-02-15'),
    },
  });

  // Set workflow to first step
  const firstStep = await prisma.workflowStep.findFirst({
    where: { workflowId: bioInspectionWF.id },
    orderBy: { order: 'asc' },
  });
  if (firstStep) {
    await prisma.workOrder.update({
      where: { id: demoWO.id },
      data: { currentStepId: firstStep.id },
    });
  }

  // Assign users
  await prisma.workOrderAssignment.create({
    data: { workOrderId: demoWO.id, userId: operator.id, role: 'LEAD' },
  });
  await prisma.workOrderAssignment.create({
    data: { workOrderId: demoWO.id, userId: manager.id, role: 'REVIEWER' },
  });

  console.log('Created demo work order:', demoWO.referenceNumber);

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
