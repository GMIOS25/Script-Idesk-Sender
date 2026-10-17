import { interceptXHR, interceptFetch } from './services/interceptor.js';
import { createDashboard } from './ui/dashboard.js';
import './controllers/mainController.js'; // side-effect: đăng ký lắng nghe 'scan-requested'/'fill-requested'

const init = () => {
    interceptXHR();
    interceptFetch();

    const waitAndStart = () => {
        if (!document.getElementById('received-document-widget')) {
            setTimeout(waitAndStart, 400);
            return;
        }
        createDashboard();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitAndStart);
    } else {
        waitAndStart();
    }
};

init();
