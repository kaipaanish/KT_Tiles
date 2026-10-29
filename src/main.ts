import './styles.css';
import './panels.css';
import './photo.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
// ?view=ar is the AR test screen (step 3a), loaded only when asked for.
if (root && new URLSearchParams(location.search).get('view') === 'ar') void import('./ar/arView').then((ar) => ar.startAr(root));
else if (root) startApp(root);
