import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as idesk from '../src/outgoing/idesk.js';

const originalFetch = globalThis.fetch;
const organization = { code: 'H21.20', name: 'Thanh tra tỉnh Gia Lai', identifier: 'organ-20', uuid: 'directory-20', sphere: 'int_province_comm' };
const setup = () => {
    globalThis.window = { location: { origin: 'https://vpdt.gialai.gov.vn', pathname: '/vpub/smartcloud/idesk6/page/paperwork/ed/publish-doc.cpx' },
        iNet: { systemConfig: { allow_center_code_list: 'live-center' } } };
    idesk.context.basePath = ''; idesk.context.execAcode = 'current-actor';
};
const response = body => ({ ok: true, status: 200, json: async () => body });
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.window; idesk.organizationDirectory.clear(); idesk.internalDirectory.clear(); idesk.context.basePath = ''; idesk.context.execAcode = ''; });

test('captures searched organizations and keeps current directory names when history is loaded later', () => {
    setup();
    assert.equal(idesk.ingestResponse('/vpub/smartcloud/idkmoni/organs/fbysphere.cpx?sphere=int_province_comm&keyword=Thanh', { elements: [organization] }), true);
    idesk.ingestResponse('/vpub/smartcloud/history/organext/list.cpx?sphere=int_province_comm', { elements: [{ ...organization, name: 'Old label', uuid: 'history-20' }] });
    assert.equal(idesk.organizationDirectory.get('int_province_comm:H21.20').name, organization.name);
    assert.equal(idesk.ingestResponse('/vpub/smartcloud/idkmoni/organs/fbysphere.cpx', { elements: [{ ...organization, sphere: 'ext_province_comm' }] }, 'sphere=ext_province_comm'), true);
    assert.equal(idesk.organizationDirectory.size, 2);
});

test('loads category lists with live category IDs and center config, deduplicating both communication spheres', async () => {
    setup();
    const requests = [];
    globalThis.fetch = async (url, init) => {
        const target = new URL(url, window.location.origin); requests.push({ target, init });
        if (target.pathname.endsWith('extorgancategory/list.cpx')) {
            const params = new URLSearchParams(init.body);
            return response({ total: 1, items: [{ uuid: 'category-' + params.get('sphere'), name: 'Sở ban ngành' }] });
        }
        const sphere = target.searchParams.get('sphere');
        assert.equal(target.searchParams.get('cateId'), 'category-' + sphere);
        assert.equal(target.searchParams.get('centerCode'), sphere === 'int_province_comm' ? 'live-center' : null);
        return response({ elements: [{ ...organization, sphere }] });
    };
    const catalog = await idesk.fetchOrganizationCatalog();
    assert.equal(catalog.elements.length, 2);
    assert.equal(catalog.coverage, 'category_lists');
    assert.deepEqual(catalog.warnings, []);
    assert.ok(requests.every(r => r.init.credentials === 'same-origin'));
    assert.equal(idesk.organizationDirectory.size, 2);
});

test('live keyword search rejects login/malformed and wrong-sphere data instead of caching an empty success', async () => {
    setup();
    globalThis.fetch = async url => {
        const target = new URL(url, window.location.origin);
        assert.equal(target.searchParams.get('keyword'), 'Thanh Tra Tỉnh');
        return response({ elements: [organization] });
    };
    const found = await idesk.searchOrganizations('Thanh Tra Tỉnh', ['int_province_comm']);
    assert.equal(found.elements[0].code, 'H21.20');
    globalThis.fetch = async () => response({ error: 'login required' });
    await assert.rejects(idesk.searchOrganizations('Thanh Tra Tỉnh', ['int_province_comm']), /dữ liệu|danh bạ|phiên/i);
    globalThis.fetch = async () => response({ elements: [{ ...organization, sphere: 'ext_province_comm' }] });
    await assert.rejects(idesk.searchOrganizations('Thanh Tra Tỉnh', ['int_province_comm']), /phạm vi|sphere/i);
});

test('keeps successful catalog groups while reporting unavailable or truncated groups', async () => {
    setup();
    globalThis.fetch = async (url, init) => {
        const target = new URL(url, window.location.origin);
        if (target.pathname.endsWith('extorgancategory/list.cpx')) {
            if (new URLSearchParams(init.body).get('sphere') === 'ext_province_comm') throw new Error('offline');
            return response({ total: 1, items: [{ uuid: 'live-group' }] });
        }
        return response({ total: 2, elements: [organization] });
    };
    const catalog = await idesk.fetchOrganizationCatalog();
    assert.equal(catalog.elements.length, 1);
    assert.ok(catalog.warnings.some(w => /giới hạn|đầy đủ|cắt/i.test(w)));
    assert.ok(catalog.warnings.some(w => /ext_province_comm/.test(w)));
});

test('lookup sync payload includes directory units even when history omits them', async () => {
    setup();
    globalThis.fetch = async (url, init) => {
        const target = new URL(url, window.location.origin);
        if (target.pathname.includes('extorgancategory')) return response({ items: [{ uuid: 'category' }] });
        if (target.pathname.includes('/organs/fbysphere')) return response({ elements: [{ ...organization, sphere: target.searchParams.get('sphere') }] });
        return response({ elements: [] });
    };
    const payload = await idesk.fetchLookupPayload();
    assert.equal(payload.unit_internal.elements.length, 0);
    assert.equal(payload.unit_directory.elements.length, 2);
});

test('verifies an enriched recipient by live exact code after a reload with history-only catalogs', async () => {
    setup(); const searched = [];
    globalThis.fetch = async url => {
        const target = new URL(url, window.location.origin);
        if (target.pathname.includes('/organs/fbysphere')) {
            searched.push(target.searchParams.get('keyword'));
            return response({ elements: [organization] });
        }
        return response({ elements: [] });
    };
    await idesk.primeDirectories([{ code: 'H21.20', sphere: 'int_province_comm' }]);
    assert.deepEqual(searched, ['H21.20']);
    assert.equal(idesk.organizationDirectory.get('int_province_comm:H21.20').identifier, 'organ-20');
});
