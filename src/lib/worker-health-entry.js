import { mountWorkerHealth } from './worker-health/workbench.js';
import fontUrl from '../assets/worker-health-font.ttf?url';
export function mount(root) { mountWorkerHealth(root, { fontUrl }); }
