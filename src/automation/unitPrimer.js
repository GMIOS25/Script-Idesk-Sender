import { state, unitCache } from '../state.js';
import { handleUnitsResponse } from '../services/api.js';
import { appendLog } from '../utils/logger.js';
import { getFallbackBasePath } from '../utils/helpers.js';

export const primeUnitTreeDirect = async () => {
    if (state.unitsPrimed || unitCache.size > 0) return true;
    if (!state.execAcode) {
        appendLog('Mồi cây đơn vị: chưa có exeacode (cần mở ít nhất 1 văn bản trước), sẽ thử lại sau.');
        return false;
    }

    const bp = state.basePath || getFallbackBasePath();
    const body = new URLSearchParams({
        exeacode: state.execAcode,
        type: 'transfer',
        responsibility: 'main'
    });

    try {
        const resp = await fetch(`${bp}/comm/nodes/fbyvsphere.cpx`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body.toString()
        });

        if (!resp.ok) {
            appendLog(`Mồi cây đơn vị: fbyvsphere.cpx trả về HTTP ${resp.status}`);
            return false;
        }

        handleUnitsResponse(await resp.json());

        if (unitCache.size > 0) {
            state.unitsPrimed = true;
            appendLog(`Mồi cây đơn vị thành công: ${unitCache.size} đơn vị/cá nhân sẵn sàng.`);
            return true;
        }
        appendLog('Mồi cây đơn vị: API trả về nhưng không có phần tử nào.');
    } catch (e) {
        appendLog(`Mồi cây đơn vị thất bại: ${e.message}`);
    }
    return false;
};
