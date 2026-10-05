import './styles.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root) startApp(root);
