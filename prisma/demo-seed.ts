import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const USER_EMAIL = 'mathewharvey@gmail.com';

async function main() {
  console.log('Creating demo data...');

  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`User ${USER_EMAIL} not found`);

  const orgUser = await prisma.organisationUser.findFirst({
    where: { userId: user.id },
    include: { organisation: true },
  });
  if (!orgUser) throw new Error('No organisation found for user');

  const orgId = orgUser.organisationId;
  console.log(`Using org: ${orgUser.organisation.name} (${orgId})`);

  // Update org to look professional
  await prisma.organisation.update({
    where: { id: orgId },
    data: {
      name: 'Franmarine Underwater Services',
      type: 'SERVICE_PROVIDER',
      abn: '52 637 233 763',
      contactEmail: 'operations@franmarine.com.au',
      contactPhone: '+61 8 9410 2233',
      address: '1/6 Coventry St, Henderson WA 6166',
    },
  });

  // Create additional team members
  const passwordHash = await bcrypt.hash('changeme123', 10);

  const teamMembers = [
    { email: 'sarah.chen@franmarine.com.au', firstName: 'Sarah', lastName: 'Chen', role: 'MANAGER' },
    { email: 'james.wilson@franmarine.com.au', firstName: 'James', lastName: 'Wilson', role: 'OPERATOR' },
    { email: 'mike.thompson@franmarine.com.au', firstName: 'Mike', lastName: 'Thompson', role: 'OPERATOR' },
    { email: 'lisa.nguyen@franmarine.com.au', firstName: 'Lisa', lastName: 'Nguyen', role: 'VIEWER' },
  ];

  const createdUsers: Record<string, string> = {};
  for (const tm of teamMembers) {
    const u = await prisma.user.upsert({
      where: { email: tm.email },
      update: {},
      create: { email: tm.email, passwordHash, firstName: tm.firstName, lastName: tm.lastName },
    });
    await prisma.organisationUser.upsert({
      where: { userId_organisationId: { userId: u.id, organisationId: orgId } },
      update: {},
      create: {
        userId: u.id,
        organisationId: orgId,
        role: tm.role,
        permissions: JSON.stringify(
          tm.role === 'MANAGER'
            ? ['VESSEL_VIEW', 'VESSEL_EDIT', 'WORK_ORDER_CREATE', 'WORK_ORDER_EDIT', 'WORK_ORDER_ASSIGN', 'WORK_ORDER_APPROVE', 'WORK_ORDER_VIEW', 'INSPECTION_CREATE', 'INSPECTION_EDIT', 'INSPECTION_APPROVE', 'INSPECTION_VIEW', 'REPORT_GENERATE', 'REPORT_VIEW', 'USER_INVITE']
            : tm.role === 'OPERATOR'
            ? ['VESSEL_VIEW', 'WORK_ORDER_VIEW', 'INSPECTION_CREATE', 'INSPECTION_EDIT', 'INSPECTION_VIEW', 'REPORT_VIEW']
            : ['VESSEL_VIEW', 'WORK_ORDER_VIEW', 'INSPECTION_VIEW', 'REPORT_VIEW']
        ),
        isDefault: true,
      },
    });
    createdUsers[tm.email] = u.id;
    console.log(`  Team member: ${tm.firstName} ${tm.lastName} (${tm.role})`);
  }

  // Create a client organisation
  const clientOrg = await prisma.organisation.upsert({
    where: { id: 'org-svitzer-demo' },
    update: {},
    create: {
      id: 'org-svitzer-demo',
      name: 'Svitzer Australia',
      type: 'VESSEL_OPERATOR',
      contactEmail: 'ops@svitzer.com.au',
      contactPhone: '+61 2 8424 7600',
      address: 'Level 6, 477 Collins Street, Melbourne VIC 3000',
    },
  });

  const clientOrg2 = await prisma.organisation.upsert({
    where: { id: 'org-defence-demo' },
    update: {},
    create: {
      id: 'org-defence-demo',
      name: 'Royal Australian Navy',
      type: 'VESSEL_OPERATOR',
      contactEmail: 'maintenance@navy.gov.au',
      address: 'Fleet Base West, Rockingham WA 6168',
    },
  });

  // Create vessels with rich data
  const vessels = [];

  const v1 = await prisma.vessel.create({
    data: {
      organisationId: orgId,
      name: 'Svitzer Dorado',
      vesselType: 'TUG',
      imoNumber: '9876543',
      mmsi: '503001234',
      callSign: 'VZD5',
      flagState: 'Australia',
      homePort: 'Fremantle',
      status: 'ACTIVE',
      complianceStatus: 'COMPLIANT',
      grossTonnage: 450,
      lengthOverall: 32.5,
      beam: 12.8,
      maxDraft: 5.2,
      yearBuilt: 2015,
      classificationSociety: 'Lloyd\'s Register',
      afsCoatingType: 'Biocidal',
      afsManufacturer: 'Jotun',
      afsProductName: 'SeaQuantum X200',
      afsApplicationDate: new Date('2023-06-15'),
      afsServiceLife: 60,
      lastDrydockDate: new Date('2023-06-01'),
      nextDrydockDate: new Date('2028-06-01'),
      typicalSpeed: 14,
      operatingArea: 'Western Australia',
      climateZones: JSON.stringify(['Tropical', 'Subtropical']),
    },
  });
  vessels.push(v1);
  console.log(`  Vessel: ${v1.name}`);

  const v2 = await prisma.vessel.create({
    data: {
      organisationId: orgId,
      name: 'HMAS Anzac',
      vesselType: 'NAVAL_FRIGATE',
      imoNumber: '8900001',
      flagState: 'Australia',
      homePort: 'Fleet Base West',
      status: 'ACTIVE',
      complianceStatus: 'DUE_FOR_INSPECTION',
      grossTonnage: 3600,
      lengthOverall: 118,
      beam: 14.8,
      maxDraft: 4.35,
      yearBuilt: 1996,
      classificationSociety: 'Defence Maritime Services',
      afsCoatingType: 'Non-biocidal',
      afsManufacturer: 'International Paint',
      afsProductName: 'Intersleek 1100SR',
      afsApplicationDate: new Date('2024-01-20'),
      afsServiceLife: 36,
      lastDrydockDate: new Date('2024-01-10'),
      nextDrydockDate: new Date('2027-01-10'),
      typicalSpeed: 27,
      operatingArea: 'Indo-Pacific',
      climateZones: JSON.stringify(['Tropical', 'Subtropical', 'Temperate']),
    },
  });
  vessels.push(v2);
  console.log(`  Vessel: ${v2.name}`);

  const v3 = await prisma.vessel.create({
    data: {
      organisationId: orgId,
      name: 'Cape Leeuwin Beacon',
      vesselType: 'NAVIGATION_AID',
      homePort: 'Cape Leeuwin',
      status: 'ACTIVE',
      complianceStatus: 'COMPLIANT',
      operatingArea: 'Cape Leeuwin, Western Australia',
      climateZones: JSON.stringify(['Temperate']),
    },
  });
  vessels.push(v3);
  console.log(`  Vessel: ${v3.name}`);

  const v4 = await prisma.vessel.create({
    data: {
      organisationId: orgId,
      name: 'Pacific Explorer',
      vesselType: 'OFFSHORE_VESSEL',
      imoNumber: '9654321',
      mmsi: '503009876',
      callSign: 'VKP7',
      flagState: 'Australia',
      homePort: 'Dampier',
      status: 'ACTIVE',
      complianceStatus: 'NON_COMPLIANT',
      grossTonnage: 5200,
      lengthOverall: 85,
      beam: 20,
      maxDraft: 6.5,
      yearBuilt: 2010,
      classificationSociety: 'DNV',
      afsCoatingType: 'Biocidal',
      afsManufacturer: 'Hempel',
      afsProductName: 'Hempaguard X7',
      afsApplicationDate: new Date('2022-03-10'),
      afsServiceLife: 60,
      lastDrydockDate: new Date('2022-03-01'),
      nextDrydockDate: new Date('2027-03-01'),
      typicalSpeed: 12,
      operatingArea: 'North West Shelf, Australia',
      climateZones: JSON.stringify(['Tropical']),
    },
  });
  vessels.push(v4);
  console.log(`  Vessel: ${v4.name}`);

  const v5 = await prisma.vessel.create({
    data: {
      organisationId: orgId,
      name: 'Svitzer Dorado II',
      vesselType: 'TUG',
      imoNumber: '9876544',
      flagState: 'Australia',
      homePort: 'Fremantle',
      status: 'ACTIVE',
      complianceStatus: 'COMPLIANT',
      grossTonnage: 480,
      lengthOverall: 34,
      beam: 13,
      maxDraft: 5.5,
      yearBuilt: 2018,
      classificationSociety: 'Lloyd\'s Register',
      afsCoatingType: 'Biocidal',
      afsManufacturer: 'Jotun',
      afsProductName: 'SeaQuantum Ultra S',
      afsApplicationDate: new Date('2024-09-15'),
      afsServiceLife: 60,
      lastDrydockDate: new Date('2024-09-01'),
      nextDrydockDate: new Date('2029-09-01'),
      typicalSpeed: 15,
      operatingArea: 'Western Australia',
      climateZones: JSON.stringify(['Subtropical']),
    },
  });
  vessels.push(v5);
  console.log(`  Vessel: ${v5.name}`);

  const v6 = await prisma.vessel.create({
    data: {
      organisationId: orgId,
      name: 'MV Iron Chieftain',
      vesselType: 'BULK_CARRIER',
      imoNumber: '9234567',
      mmsi: '503005678',
      callSign: 'VJIC',
      flagState: 'Australia',
      homePort: 'Port Hedland',
      status: 'ACTIVE',
      complianceStatus: 'COMPLIANT',
      grossTonnage: 47000,
      lengthOverall: 225,
      beam: 32.2,
      maxDraft: 14.5,
      yearBuilt: 2008,
      classificationSociety: 'Bureau Veritas',
      afsCoatingType: 'Biocidal',
      afsManufacturer: 'AkzoNobel',
      afsProductName: 'Intersmooth 7465HS SPC',
      afsApplicationDate: new Date('2024-04-20'),
      afsServiceLife: 60,
      lastDrydockDate: new Date('2024-04-01'),
      nextDrydockDate: new Date('2029-04-01'),
      typicalSpeed: 14.5,
      operatingArea: 'Australia - East Asia',
      climateZones: JSON.stringify(['Tropical', 'Subtropical']),
    },
  });
  vessels.push(v6);
  console.log(`  Vessel: ${v6.name}`);

  // Create niche areas for first 3 vessels
  const nicheAreaDefs = [
    { name: 'Sea Chest Port', location: 'Port side, below waterline' },
    { name: 'Sea Chest Starboard', location: 'Starboard side, below waterline' },
    { name: 'Bow Thruster', location: 'Forward' },
    { name: 'Rudder', location: 'Stern' },
    { name: 'Propeller', location: 'Stern, below waterline' },
    { name: 'MGPS Anodes', location: 'Port & Starboard sea chests' },
    { name: 'Echo Sounder', location: 'Forward bottom' },
  ];

  for (const v of [v1, v2, v4]) {
    for (const na of nicheAreaDefs) {
      await prisma.nicheArea.create({ data: { vesselId: v.id, ...na } });
    }
    console.log(`  Niche areas created for ${v.name}`);
  }

  // Create vessel components for Svitzer Dorado (v1)
  const componentDefs = [
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

  const componentIds: Record<string, string> = {};
  for (const comp of componentDefs) {
    const c = await prisma.vesselComponent.create({ data: { vesselId: v1.id, ...comp } });
    componentIds[comp.name] = c.id;
  }
  console.log(`  ${componentDefs.length} components for ${v1.name}`);

  // Also add components for v2 (HMAS Anzac)
  for (const comp of componentDefs) {
    await prisma.vesselComponent.create({ data: { vesselId: v2.id, ...comp } });
  }
  console.log(`  ${componentDefs.length} components for ${v2.name}`);

  // Create workflow templates
  const bioInspectionWF = await prisma.workflow.create({
    data: {
      name: 'Biofouling Inspection',
      description: 'Standard biofouling inspection workflow with review and report generation',
      isTemplate: true,
      isActive: true,
      steps: {
        create: [
          {
            name: 'Pre-Inspection Planning', order: 1, type: 'DATA_CAPTURE', requiredRole: 'OPERATOR',
            tasks: { create: [
              { name: 'Pre-inspection checklist', order: 1, taskType: 'CHECKLIST', isRequired: true },
              { name: 'Upload vessel documents', order: 2, taskType: 'FILE_UPLOAD', isRequired: false },
            ]},
          },
          {
            name: 'Field Inspection', order: 2, type: 'DATA_CAPTURE', requiredRole: 'OPERATOR',
            tasks: { create: [
              { name: 'Record inspection findings', order: 1, taskType: 'INSPECTION_RECORD', isRequired: true },
              { name: 'Capture photos', order: 2, taskType: 'PHOTO_CAPTURE', isRequired: true },
              { name: 'Inspector notes', order: 3, taskType: 'NOTE', isRequired: false },
            ]},
          },
          {
            name: 'Review', order: 3, type: 'PARALLEL_REVIEW', requiredRole: 'MANAGER',
            tasks: { create: [
              { name: 'Manager approval', order: 1, taskType: 'APPROVAL', isRequired: true },
            ]},
          },
          {
            name: 'Report Generation', order: 4, type: 'REPORT_GENERATION', autoAdvance: true,
            tasks: { create: [
              { name: 'Generate inspection report', order: 1, taskType: 'NOTE', isRequired: true },
            ]},
          },
          {
            name: 'Final Approval', order: 5, type: 'REVIEW', requiredRole: 'MANAGER',
            tasks: { create: [
              { name: 'Final sign-off', order: 1, taskType: 'SIGNATURE', isRequired: true },
            ]},
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
            name: 'Pre-Clean Inspection', order: 1, type: 'DATA_CAPTURE', requiredRole: 'OPERATOR',
            tasks: { create: [
              { name: 'Record pre-clean condition', order: 1, taskType: 'INSPECTION_RECORD', isRequired: true },
              { name: 'Take before photos', order: 2, taskType: 'PHOTO_CAPTURE', isRequired: true },
            ]},
          },
          {
            name: 'Cleaning Execution', order: 2, type: 'DATA_CAPTURE', requiredRole: 'OPERATOR',
            tasks: { create: [
              { name: 'Record cleaning activities', order: 1, taskType: 'FORM_FILL', isRequired: true },
            ]},
          },
          {
            name: 'Post-Clean Inspection', order: 3, type: 'DATA_CAPTURE', requiredRole: 'OPERATOR',
            tasks: { create: [
              { name: 'Record post-clean condition', order: 1, taskType: 'INSPECTION_RECORD', isRequired: true },
              { name: 'Take after photos', order: 2, taskType: 'PHOTO_CAPTURE', isRequired: true },
            ]},
          },
          {
            name: 'Environmental Compliance Check', order: 4, type: 'REVIEW', requiredRole: 'MANAGER',
            tasks: { create: [
              { name: 'Environmental compliance approval', order: 1, taskType: 'APPROVAL', isRequired: true },
            ]},
          },
          {
            name: 'Report Generation', order: 5, type: 'REPORT_GENERATION', autoAdvance: true,
            tasks: { create: [
              { name: 'Generate cleaning report', order: 1, taskType: 'NOTE', isRequired: true },
            ]},
          },
          {
            name: 'Client Sign-off', order: 6, type: 'PARALLEL_REVIEW',
            tasks: { create: [
              { name: 'Client approval', order: 1, taskType: 'SIGNATURE', isRequired: true },
            ]},
          },
        ],
      },
    },
  });

  console.log(`  Workflows: ${bioInspectionWF.name}, ${hullCleaningWF.name}`);

  // Get first workflow step for work orders
  const bioFirstStep = await prisma.workflowStep.findFirst({
    where: { workflowId: bioInspectionWF.id },
    orderBy: { order: 'asc' },
  });

  // Create work orders with various statuses
  const wo1 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260215-0010',
      vesselId: v1.id,
      organisationId: orgId,
      workflowId: bioInspectionWF.id,
      currentStepId: bioFirstStep?.id,
      title: 'Biofouling Inspection - Svitzer Dorado',
      description: 'Scheduled underwater biofouling inspection of hull and niche areas per DAWR regulations. Vessel has been operating in tropical waters for 8 months since last drydock.',
      type: 'BIOFOULING_INSPECTION',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      location: 'Fremantle Inner Harbour, Berth C',
      latitude: -32.0569,
      longitude: 115.7411,
      scheduledStart: new Date('2026-03-10'),
      scheduledEnd: new Date('2026-03-12'),
      actualStart: new Date('2026-03-10'),
    },
  });
  await prisma.workOrderAssignment.create({ data: { workOrderId: wo1.id, userId: user.id, role: 'LEAD' } });
  if (createdUsers['james.wilson@franmarine.com.au'])
    await prisma.workOrderAssignment.create({ data: { workOrderId: wo1.id, userId: createdUsers['james.wilson@franmarine.com.au'], role: 'TEAM_MEMBER' } });
  if (createdUsers['sarah.chen@franmarine.com.au'])
    await prisma.workOrderAssignment.create({ data: { workOrderId: wo1.id, userId: createdUsers['sarah.chen@franmarine.com.au'], role: 'REVIEWER' } });
  console.log(`  Work order: ${wo1.referenceNumber} (IN_PROGRESS)`);

  const wo2 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260301-0011',
      vesselId: v2.id,
      organisationId: orgId,
      workflowId: bioInspectionWF.id,
      title: 'Hull Condition Assessment - HMAS Anzac',
      description: 'Pre-maintenance period underwater hull survey and coating assessment',
      type: 'COATING_ASSESSMENT',
      priority: 'NORMAL',
      status: 'DRAFT',
      location: 'Fleet Base West, Rockingham',
      latitude: -32.2900,
      longitude: 115.7550,
      scheduledStart: new Date('2026-03-20'),
      scheduledEnd: new Date('2026-03-22'),
    },
  });
  console.log(`  Work order: ${wo2.referenceNumber} (DRAFT)`);

  const wo3 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260205-0008',
      vesselId: v4.id,
      organisationId: orgId,
      workflowId: hullCleaningWF.id,
      title: 'Emergency Hull Cleaning - Pacific Explorer',
      description: 'Urgent hull cleaning required due to heavy macrofouling detected during port state inspection. Vessel has been idle for 3 months in tropical waters.',
      type: 'HULL_CLEANING',
      priority: 'URGENT',
      status: 'IN_PROGRESS',
      location: 'Dampier Port, WA',
      latitude: -20.6611,
      longitude: 116.7111,
      scheduledStart: new Date('2026-03-08'),
      scheduledEnd: new Date('2026-03-09'),
      actualStart: new Date('2026-03-08'),
    },
  });
  if (createdUsers['mike.thompson@franmarine.com.au'])
    await prisma.workOrderAssignment.create({ data: { workOrderId: wo3.id, userId: createdUsers['mike.thompson@franmarine.com.au'], role: 'LEAD' } });
  await prisma.workOrderAssignment.create({ data: { workOrderId: wo3.id, userId: user.id, role: 'REVIEWER' } });
  console.log(`  Work order: ${wo3.referenceNumber} (IN_PROGRESS, URGENT)`);

  const wo4 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260110-0005',
      vesselId: v5.id,
      organisationId: orgId,
      workflowId: bioInspectionWF.id,
      title: 'Biofouling Inspection - Svitzer Dorado II',
      description: 'Routine biofouling inspection completed. All areas within acceptable limits. Light slime observed on flat bottom, no macrofouling.',
      type: 'BIOFOULING_INSPECTION',
      priority: 'NORMAL',
      status: 'COMPLETED',
      location: 'Fremantle Inner Harbour',
      latitude: -32.0569,
      longitude: 115.7411,
      scheduledStart: new Date('2026-01-10'),
      scheduledEnd: new Date('2026-01-11'),
      actualStart: new Date('2026-01-10'),
      actualEnd: new Date('2026-01-11'),
      completedAt: new Date('2026-01-11'),
    },
  });
  await prisma.workOrderAssignment.create({ data: { workOrderId: wo4.id, userId: user.id, role: 'LEAD' } });
  console.log(`  Work order: ${wo4.referenceNumber} (COMPLETED)`);

  const wo5 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260228-0009',
      vesselId: v6.id,
      organisationId: orgId,
      title: 'Cathodic Protection Survey - MV Iron Chieftain',
      description: 'Underwater cathodic protection system survey. Anode depletion assessment and potential readings required.',
      type: 'CATHODIC_PROTECTION',
      priority: 'HIGH',
      status: 'APPROVED',
      location: 'Port Hedland, WA',
      latitude: -20.3118,
      longitude: 118.5740,
      scheduledStart: new Date('2026-03-15'),
      scheduledEnd: new Date('2026-03-16'),
    },
  });
  if (createdUsers['james.wilson@franmarine.com.au'])
    await prisma.workOrderAssignment.create({ data: { workOrderId: wo5.id, userId: createdUsers['james.wilson@franmarine.com.au'], role: 'LEAD' } });
  console.log(`  Work order: ${wo5.referenceNumber} (APPROVED)`);

  const wo6 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260120-0006',
      vesselId: v1.id,
      organisationId: orgId,
      workflowId: hullCleaningWF.id,
      title: 'Hull Cleaning - Svitzer Dorado',
      description: 'Proactive hull cleaning following January inspection. Focused on boot top and niche areas. Environmental compliance documented.',
      type: 'HULL_CLEANING',
      priority: 'NORMAL',
      status: 'COMPLETED',
      location: 'Fremantle Inner Harbour',
      latitude: -32.0569,
      longitude: 115.7411,
      scheduledStart: new Date('2026-01-20'),
      scheduledEnd: new Date('2026-01-21'),
      actualStart: new Date('2026-01-20'),
      actualEnd: new Date('2026-01-21'),
      completedAt: new Date('2026-01-21'),
    },
  });
  await prisma.workOrderAssignment.create({ data: { workOrderId: wo6.id, userId: user.id, role: 'LEAD' } });
  console.log(`  Work order: ${wo6.referenceNumber} (COMPLETED)`);

  const wo7 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260305-0012',
      vesselId: v3.id,
      organisationId: orgId,
      title: 'Navigation Aid Inspection - Cape Leeuwin',
      description: 'Annual navigation aid inspection and maintenance check',
      type: 'NAVIGATION_AID_INSPECTION',
      priority: 'NORMAL',
      status: 'PENDING_APPROVAL',
      location: 'Cape Leeuwin, WA',
      latitude: -34.3725,
      longitude: 115.1355,
      scheduledStart: new Date('2026-03-25'),
      scheduledEnd: new Date('2026-03-26'),
    },
  });
  console.log(`  Work order: ${wo7.referenceNumber} (PENDING_APPROVAL)`);

  const wo8 = await prisma.workOrder.create({
    data: {
      referenceNumber: 'WO-20260201-0007',
      vesselId: v2.id,
      organisationId: orgId,
      workflowId: bioInspectionWF.id,
      title: 'Biofouling Inspection - HMAS Anzac (Q4 2025)',
      description: 'Quarterly inspection completed. Moderate fouling on sea chests, light slime on hull. Niche area cleaning recommended.',
      type: 'BIOFOULING_INSPECTION',
      priority: 'NORMAL',
      status: 'COMPLETED',
      location: 'Fleet Base West',
      latitude: -32.2900,
      longitude: 115.7550,
      scheduledStart: new Date('2026-02-01'),
      scheduledEnd: new Date('2026-02-02'),
      actualStart: new Date('2026-02-01'),
      actualEnd: new Date('2026-02-02'),
      completedAt: new Date('2026-02-02'),
    },
  });
  await prisma.workOrderAssignment.create({ data: { workOrderId: wo8.id, userId: user.id, role: 'LEAD' } });
  console.log(`  Work order: ${wo8.referenceNumber} (COMPLETED)`);

  // Create inspections with findings for completed work orders
  const inspection1 = await prisma.inspection.create({
    data: {
      workOrderId: wo4.id,
      vesselId: v5.id,
      type: 'BIOFOULING',
      status: 'COMPLETED',
      inspectorName: 'Mathew Harvey',
      inspectorOrg: 'Franmarine Underwater Services',
      inspectorCert: 'ADAS Part 2 Diver #12345',
      waterTemp: 22,
      waterVisibility: 8,
      waterSalinity: 35.2,
      weatherConditions: 'Clear, light breeze',
      seaState: 'Calm',
      tideState: 'Low tide',
      location: 'Fremantle Inner Harbour',
      latitude: -32.0569,
      longitude: 115.7411,
      overallRating: 1,
      summary: 'Light slime layer observed on flat bottom sections. Hull coating in good condition. Niche areas clear of macrofouling. Vessel compliant with DAWR biofouling requirements.',
      recommendations: 'Schedule next inspection within 12 months. Continue current maintenance regime.',
      startedAt: new Date('2026-01-10T08:00:00Z'),
      completedAt: new Date('2026-01-10T14:00:00Z'),
    },
  });

  const findingsData1 = [
    { area: 'Hull - Flat Bottom', foulingRating: 1, foulingType: 'Slime', coverage: 15, condition: 'Good', coatingCondition: 'Intact', description: 'Light biofilm/slime layer. No macrofouling detected.', recommendation: 'Monitor at next inspection' },
    { area: 'Hull - Boot Top Port', foulingRating: 0, foulingType: 'None', coverage: 0, condition: 'Good', coatingCondition: 'Intact', description: 'Clean, no fouling detected', recommendation: 'No action required' },
    { area: 'Hull - Boot Top Starboard', foulingRating: 0, foulingType: 'None', coverage: 0, condition: 'Good', coatingCondition: 'Intact', description: 'Clean, no fouling detected', recommendation: 'No action required' },
    { area: 'Hull - Vertical Side Port', foulingRating: 1, foulingType: 'Slime', coverage: 10, condition: 'Good', coatingCondition: 'Intact', description: 'Faint slime layer, easily wiped', recommendation: 'No action required' },
    { area: 'Hull - Vertical Side Starboard', foulingRating: 1, foulingType: 'Slime', coverage: 12, condition: 'Good', coatingCondition: 'Intact', description: 'Faint slime layer, easily wiped', recommendation: 'No action required' },
    { area: 'Sea Chest - Port', foulingRating: 1, foulingType: 'Slime', coverage: 20, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Light slime in sea chest. Gratings clear.', recommendation: 'Clean at next maintenance window' },
    { area: 'Sea Chest - Starboard', foulingRating: 1, foulingType: 'Slime', coverage: 18, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Light slime in sea chest. Gratings clear.', recommendation: 'Clean at next maintenance window' },
    { area: 'Propeller', foulingRating: 0, foulingType: 'None', coverage: 0, condition: 'Good', coatingCondition: 'N/A', description: 'Propeller clean, no fouling', recommendation: 'No action required' },
    { area: 'Rudder', foulingRating: 1, foulingType: 'Slime', coverage: 8, condition: 'Good', coatingCondition: 'Intact', description: 'Very light slime on rudder blade', recommendation: 'No action required' },
    { area: 'Bow Thruster', foulingRating: 0, foulingType: 'None', coverage: 0, condition: 'Good', coatingCondition: 'Intact', description: 'Bow thruster tunnel clear', recommendation: 'No action required' },
  ];

  for (const f of findingsData1) {
    await prisma.inspectionFinding.create({ data: { inspectionId: inspection1.id, ...f } });
  }
  console.log(`  Inspection + ${findingsData1.length} findings for ${wo4.referenceNumber}`);

  // HMAS Anzac inspection
  const inspection2 = await prisma.inspection.create({
    data: {
      workOrderId: wo8.id,
      vesselId: v2.id,
      type: 'BIOFOULING',
      status: 'COMPLETED',
      inspectorName: 'Mathew Harvey',
      inspectorOrg: 'Franmarine Underwater Services',
      inspectorCert: 'ADAS Part 2 Diver #12345',
      waterTemp: 24,
      waterVisibility: 6,
      waterSalinity: 35.5,
      weatherConditions: 'Overcast, moderate breeze',
      seaState: 'Slight',
      tideState: 'Rising tide',
      location: 'Fleet Base West',
      latitude: -32.2900,
      longitude: 115.7550,
      overallRating: 3,
      summary: 'Moderate fouling detected in niche areas, particularly sea chests and bow thruster tunnel. Hull generally in fair condition with heavy slime on flat bottom. Macrofouling (tubeworms, barnacles) in sea chests. Recommend niche area cleaning within 30 days.',
      recommendations: 'Niche area cleaning recommended within 30 days. Hull cleaning optional but beneficial. Next full inspection in 6 months.',
      startedAt: new Date('2026-02-01T07:00:00Z'),
      completedAt: new Date('2026-02-02T15:00:00Z'),
    },
  });

  const findingsData2 = [
    { area: 'Hull - Flat Bottom', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 45, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Heavy biofilm/slime across flat bottom. Some areas showing early signs of soft fouling.', recommendation: 'Hull cleaning recommended within 60 days', priority: 'NORMAL' },
    { area: 'Hull - Boot Top Port', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 30, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Heavy slime at waterline interface', recommendation: 'Clean during next maintenance', priority: 'LOW' },
    { area: 'Hull - Boot Top Starboard', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 35, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Heavy slime at waterline interface', recommendation: 'Clean during next maintenance', priority: 'LOW' },
    { area: 'Sea Chest - Port', foulingRating: 3, foulingType: 'Tubeworms/Barnacles', coverage: 40, condition: 'Poor', coatingCondition: 'Damaged', description: 'Calcareous fouling (tubeworms and small barnacles) on grating and internal surfaces. Flow restriction estimated at 15%.', recommendation: 'Urgent cleaning required. Inspect MGPS system.', actionRequired: true, priority: 'HIGH' },
    { area: 'Sea Chest - Starboard', foulingRating: 3, foulingType: 'Tubeworms/Barnacles', coverage: 35, condition: 'Poor', coatingCondition: 'Damaged', description: 'Calcareous fouling similar to port side. MGPS anode appears depleted.', recommendation: 'Urgent cleaning required. Replace MGPS anode.', actionRequired: true, priority: 'HIGH' },
    { area: 'Bow Thruster', foulingRating: 3, foulingType: 'Mixed fouling', coverage: 25, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Soft and light calcareous fouling in tunnel. Blades show heavy slime.', recommendation: 'Clean bow thruster tunnel', actionRequired: true, priority: 'NORMAL' },
    { area: 'Propeller - Port', foulingRating: 1, foulingType: 'Slime', coverage: 10, condition: 'Good', coatingCondition: 'N/A', description: 'Light slime, polished areas clear', recommendation: 'No immediate action', priority: 'LOW' },
    { area: 'Propeller - Starboard', foulingRating: 1, foulingType: 'Slime', coverage: 8, condition: 'Good', coatingCondition: 'N/A', description: 'Light slime, polished areas clear', recommendation: 'No immediate action', priority: 'LOW' },
    { area: 'Rudder - Port', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 30, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Heavy slime on rudder blade and stock', recommendation: 'Clean during hull maintenance', priority: 'LOW' },
    { area: 'Rudder - Starboard', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 28, condition: 'Fair', coatingCondition: 'Minor wear', description: 'Heavy slime on rudder blade', recommendation: 'Clean during hull maintenance', priority: 'LOW' },
    { area: 'Keel', foulingRating: 1, foulingType: 'Slime', coverage: 15, condition: 'Good', coatingCondition: 'Intact', description: 'Light slime along keel', recommendation: 'No action required', priority: 'LOW' },
    { area: 'Cathodic Protection Anodes', foulingRating: 0, foulingType: 'None', coverage: 0, condition: 'Fair', coatingCondition: 'N/A', description: 'Anodes at approximately 60% depletion. Potential readings within acceptable range (-850 to -1050 mV).', recommendation: 'Monitor at next inspection. Plan replacement within 18 months.', measurementType: 'potential', measurementValue: -920, measurementUnit: 'mV', priority: 'NORMAL' },
  ];

  for (const f of findingsData2) {
    await prisma.inspectionFinding.create({ data: { inspectionId: inspection2.id, ...f } });
  }
  console.log(`  Inspection + ${findingsData2.length} findings for ${wo8.referenceNumber}`);

  // Create work form entries for in-progress WO (wo1)
  const formEntryData = [
    { componentName: 'Hull - Flat Bottom', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 35, condition: 'Fair', coatingCondition: 'Minor wear', notes: 'Heavy biofilm across flat bottom. AFS coating showing normal wear.', status: 'COMPLETED' },
    { componentName: 'Hull - Boot Top Port', foulingRating: 1, foulingType: 'Slime', coverage: 15, condition: 'Good', coatingCondition: 'Intact', notes: 'Light slime at waterline', status: 'COMPLETED' },
    { componentName: 'Hull - Boot Top Starboard', foulingRating: 1, foulingType: 'Slime', coverage: 12, condition: 'Good', coatingCondition: 'Intact', notes: 'Light slime at waterline', status: 'COMPLETED' },
    { componentName: 'Hull - Vertical Side Port', foulingRating: 1, foulingType: 'Slime', coverage: 10, condition: 'Good', coatingCondition: 'Intact', status: 'COMPLETED' },
    { componentName: 'Hull - Vertical Side Starboard', foulingRating: 1, foulingType: 'Slime', coverage: 8, condition: 'Good', coatingCondition: 'Intact', status: 'COMPLETED' },
    { componentName: 'Sea Chest - Port', foulingRating: 2, foulingType: 'Heavy Slime', coverage: 25, condition: 'Fair', coatingCondition: 'Minor wear', notes: 'Heavier slime in sea chest. Gratings partially obstructed.', actionRequired: true, recommendation: 'Schedule cleaning', status: 'COMPLETED' },
    { componentName: 'Sea Chest - Starboard', foulingRating: null, foulingType: null, coverage: null, condition: null, coatingCondition: null, status: 'PENDING' },
    { componentName: 'Bow Thruster', foulingRating: null, foulingType: null, coverage: null, condition: null, coatingCondition: null, status: 'PENDING' },
    { componentName: 'Propeller - Port', foulingRating: null, foulingType: null, coverage: null, condition: null, coatingCondition: null, status: 'PENDING' },
    { componentName: 'Propeller - Starboard', foulingRating: null, foulingType: null, coverage: null, condition: null, coatingCondition: null, status: 'PENDING' },
  ];

  for (const entry of formEntryData) {
    const compId = componentIds[entry.componentName];
    if (!compId) continue;
    await prisma.workFormEntry.create({
      data: {
        workOrderId: wo1.id,
        vesselComponentId: compId,
        foulingRating: entry.foulingRating,
        foulingType: entry.foulingType,
        coverage: entry.coverage,
        condition: entry.condition,
        coatingCondition: entry.coatingCondition,
        notes: entry.notes || null,
        actionRequired: entry.actionRequired || false,
        recommendation: entry.recommendation || null,
        status: entry.status,
        completedAt: entry.status === 'COMPLETED' ? new Date() : null,
      },
    });
  }
  console.log(`  Form entries for ${wo1.referenceNumber}`);

  // Add comments to work orders
  await prisma.comment.create({
    data: { workOrderId: wo1.id, authorId: user.id, content: 'Starting hull inspection at 0800. Visibility is good, water temp 21°C. Proceeding with flat bottom survey first.' },
  });
  if (createdUsers['james.wilson@franmarine.com.au']) {
    await prisma.comment.create({
      data: { workOrderId: wo1.id, authorId: createdUsers['james.wilson@franmarine.com.au'], content: 'Completed flat bottom and boot top sections. Moving to niche areas next. Some heavier slime observed in port sea chest area.' },
    });
  }
  if (createdUsers['sarah.chen@franmarine.com.au']) {
    await prisma.comment.create({
      data: { workOrderId: wo1.id, authorId: createdUsers['sarah.chen@franmarine.com.au'], content: 'Noted the sea chest findings. Please ensure detailed photos of grating condition. We may need to schedule a follow-up cleaning.' },
    });
  }
  console.log('  Comments added to work orders');

  // Add some audit entries
  const lastEntry = await prisma.auditEntry.findFirst({ orderBy: { sequence: 'desc' } });
  let seq = (lastEntry?.sequence ?? 0) + 1;

  const auditEntries = [
    { entityType: 'WORK_ORDER', entityId: wo1.id, action: 'CREATE', description: `Work order ${wo1.referenceNumber} created`, actorId: user.id, actorEmail: USER_EMAIL },
    { entityType: 'WORK_ORDER', entityId: wo1.id, action: 'STATUS_CHANGE', description: `Work order ${wo1.referenceNumber} status changed to IN_PROGRESS`, actorId: user.id, actorEmail: USER_EMAIL },
    { entityType: 'VESSEL', entityId: v1.id, action: 'CREATE', description: `Vessel ${v1.name} registered`, actorId: user.id, actorEmail: USER_EMAIL },
    { entityType: 'VESSEL', entityId: v2.id, action: 'CREATE', description: `Vessel ${v2.name} registered`, actorId: user.id, actorEmail: USER_EMAIL },
    { entityType: 'INSPECTION', entityId: inspection1.id, action: 'COMPLETE', description: `Inspection completed for ${v5.name}`, actorId: user.id, actorEmail: USER_EMAIL },
    { entityType: 'INSPECTION', entityId: inspection2.id, action: 'COMPLETE', description: `Inspection completed for ${v2.name} - macrofouling detected in niche areas`, actorId: user.id, actorEmail: USER_EMAIL },
    { entityType: 'WORK_ORDER', entityId: wo3.id, action: 'CREATE', description: `Urgent work order ${wo3.referenceNumber} created for ${v4.name}`, actorId: user.id, actorEmail: USER_EMAIL },
  ];

  let prevHash = lastEntry?.hash ?? '0';
  for (const ae of auditEntries) {
    const hash = `demo-${seq}`;
    await prisma.auditEntry.create({
      data: { sequence: seq, hash, previousHash: prevHash, ...ae },
    });
    prevHash = hash;
    seq++;
  }
  console.log('  Audit entries added');

  // Add notifications
  const notifications = [
    { type: 'WORK_ORDER_ASSIGNED', title: 'New Assignment', message: `You have been assigned as Lead on ${wo1.referenceNumber} - Biofouling Inspection - Svitzer Dorado`, entityType: 'WORK_ORDER', entityId: wo1.id },
    { type: 'WORK_ORDER_STATUS', title: 'Status Update', message: `Emergency hull cleaning ${wo3.referenceNumber} is now in progress at Dampier Port`, entityType: 'WORK_ORDER', entityId: wo3.id },
    { type: 'INSPECTION_COMPLETE', title: 'Inspection Completed', message: `HMAS Anzac inspection completed. Macrofouling detected in sea chests - cleaning recommended.`, entityType: 'INSPECTION', entityId: inspection2.id },
    { type: 'WORK_ORDER_STATUS', title: 'Pending Approval', message: `Navigation aid inspection ${wo7.referenceNumber} requires your approval`, entityType: 'WORK_ORDER', entityId: wo7.id, isRead: false },
    { type: 'WORK_ORDER_STATUS', title: 'Work Order Approved', message: `Cathodic protection survey ${wo5.referenceNumber} has been approved and is ready to schedule`, entityType: 'WORK_ORDER', entityId: wo5.id, isRead: true },
  ];

  for (const n of notifications) {
    await prisma.notification.create({
      data: { userId: user.id, ...n },
    });
  }
  console.log('  Notifications added');

  console.log('\nDemo data creation complete!');
  console.log(`  ${vessels.length} vessels`);
  console.log('  8 work orders (various statuses)');
  console.log('  2 inspections with detailed findings');
  console.log('  Work form entries for in-progress WO');
  console.log('  Team members, comments, audit entries, notifications');
}

main()
  .catch((e) => {
    console.error('Demo seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
