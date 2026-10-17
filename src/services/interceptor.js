import { ensureBasePath } from '../utils/helpers.js';
import { handleListResponse, handleViewResponse, handleUnitsResponse, captureExecAcodeFromUrl } from './api.js';

const processCpxResponse = (url, data) => {
    if (url.includes('qsreceiving.cpx')) handleListResponse(data);
    else if (url.includes('view.cpx')) handleViewResponse(data);
    else if (url.includes('fbyvsphere.cpx')) handleUnitsResponse(data);
};

export const interceptXHR = () => {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            try {
                const url = this._url || '';
                if (/qsreceiving\.cpx|view\.cpx|fbyvsphere\.cpx/.test(url)) {
                    ensureBasePath(url);
                    if (url.includes('view.cpx')) captureExecAcodeFromUrl(url);
                    processCpxResponse(url, JSON.parse(this.responseText));
                }
            } catch (e) { /* silent */ }
        });
        return origSend.apply(this, arguments);
    };
};

export const interceptFetch = () => {
    const origFetch = unsafeWindow.fetch.bind(unsafeWindow);
    unsafeWindow.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : (input.url || '');
        if (url.includes('view.cpx')) captureExecAcodeFromUrl(url);
        return origFetch(input, init).then(async (response) => {
            if (/qsreceiving\.cpx|view\.cpx|fbyvsphere\.cpx/.test(url)) {
                ensureBasePath(url);
                try { processCpxResponse(url, await response.clone().json()); } catch (e) {}
            }
            return response;
        });
    };
};
