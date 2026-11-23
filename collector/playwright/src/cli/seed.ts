import { createStores } from '@cruise/shared/storage';
import { seedDemoData } from '../seed';

const stores = createStores();
const seeded = await seedDemoData(stores);
console.log(seeded ? `Seeded demo routes and mock history into ${stores.dataDir}` : 'Routes already exist; seed skipped');
