import { createRoot } from 'react-dom/client';
import { CreateMenu } from './components/CreateMenu';

// Django resolves the routes; the React island owns only this small interaction.
const host = document.querySelector<HTMLElement>('[data-create-menu]');
if (host?.dataset.classroomUrl && host.dataset.groupUrl) {
  createRoot(host).render(
    <CreateMenu classroomUrl={host.dataset.classroomUrl} groupUrl={host.dataset.groupUrl} />,
  );
}
