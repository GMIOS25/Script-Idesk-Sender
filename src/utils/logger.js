export const setStatus = (msg) => {
    const el = document.getElementById('rpa-footer-status');
    if (el) el.textContent = msg;
    appendLog(msg);
};

export const appendLog = (msg) => {
    const logBody = document.getElementById('rpa-log-body');
    if (logBody) {
        const time = new Date().toLocaleTimeString('vi-VN');
        const row = document.createElement('div');
        row.className = 'rpa-log-entry';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'rpa-log-time';
        timeSpan.textContent = `[${time}] `;
        row.appendChild(timeSpan);
        // Dùng text node thay vì innerHTML: msg chứa dữ liệu từ server (JSON response
        // router, body lỗi...) nên nội dung văn bản/LLM có thể chèn markup vào trang.
        row.appendChild(document.createTextNode(String(msg)));
        logBody.appendChild(row);
        logBody.scrollTop = logBody.scrollHeight;
    }
};
