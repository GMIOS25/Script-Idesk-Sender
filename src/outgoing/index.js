import { installInterceptors } from './idesk.js';
import { createDashboard } from './dashboard.js';

let update = () => {};
installInterceptors(() => update());
const start = () => {
    if (!document.body || !document.getElementById('publish-document-widget')) {
        setTimeout(start, 300);
        return;
    }
    update = createDashboard();
};
start();
