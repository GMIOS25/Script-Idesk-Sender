export const makePanelDraggable = panel => {
    const toolbar = panel.querySelector('.sender-toolbar');
    let drag = null;
    let positioned = false;

    const setPosition = (left, top) => {
        const x = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - panel.offsetWidth));
        const y = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - panel.offsetHeight));
        panel.style.inset = `${y}px auto auto ${x}px`;
    };
    const keepInViewport = () => {
        if (!positioned || panel.hidden) return;
        const rect = panel.getBoundingClientRect();
        setPosition(rect.left, rect.top);
    };
    const stop = event => {
        if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
        const { pointerId } = drag;
        drag = null;
        toolbar.classList.remove('sender-dragging');
        if (toolbar.hasPointerCapture(pointerId)) toolbar.releasePointerCapture(pointerId);
    };

    toolbar.addEventListener('pointerdown', event => {
        if (drag || event.button !== 0 || !event.isPrimary ||
            event.target.closest('button,a,input,select,textarea,label,[contenteditable]')) return;
        const rect = panel.getBoundingClientRect();
        toolbar.setPointerCapture(event.pointerId);
        drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        positioned = true;
        setPosition(rect.left, rect.top);
        toolbar.classList.add('sender-dragging');
        event.preventDefault();
    });
    toolbar.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        setPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    });
    toolbar.addEventListener('pointerup', stop);
    toolbar.addEventListener('pointercancel', stop);
    toolbar.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('resize', keepInViewport);
    return keepInViewport;
};
