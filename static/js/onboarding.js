/* The database owns completion, returning-user status and resumable progress. */
(() => {
    const boot = JSON.parse(document.getElementById('onboarding-bootstrap')?.textContent || 'null');
    let progress = boot?.progress || null, pending = null, saving = null, timer;
    const requestToken = boot?.requestToken || '';
    const report = () => window.dispatchEvent(new CustomEvent('onboarding-save-error'));
    async function flush() {
        clearTimeout(timer);
        if (saving) { await saving; return flush(); }
        if (!pending) return;
        const value = pending; pending = null;
        saving = (async () => {
            const response = await fetch('/api/onboarding/state/', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Onboarding-Token':requestToken},body:JSON.stringify(value),keepalive:true});
            if (!response.ok) throw new Error('引导进度保存失败，请重试。');
            const saved = await response.json();
            if (boot) { boot.seen = saved.seen; boot.returning = saved.returning; }
        })();
        try { await saving; } catch (error) { pending ||= value; throw error; } finally { saving = null; }
        if (pending) return flush();
    }
    function write(value) {
        progress = structuredClone(value); pending = progress;
        clearTimeout(timer); timer = setTimeout(()=>flush().catch(report),120);
    }
    const store = window.OnboardingStore = {boot,read:()=>progress,write,flush,isComplete:()=>!!boot?.seen};
    window.startOnboarding = () => { location.href='/welcome/?replay=1&help=1'; };
    function route() {
        if (location.pathname==='/welcome/') {
            window.FUCKSEATS_ONBOARDING_ACTIVE=true;
            if (boot?.seen && !new URLSearchParams(location.search).has('replay')) {
                window.FUCKSEATS_ONBOARDING_REDIRECTING=true;location.replace('/');
            }
        }
        if(location.pathname==='/' && boot && !boot.seen && !new URLSearchParams(location.search).has('cloud_login')) {
            window.FUCKSEATS_ONBOARDING_ACTIVE=true;location.replace('/welcome/');
        }
    }
    // Import the previous frontend-only record once; subsequent reads use the DB.
    let legacy = null;
    if (boot && !boot.seen && !Object.keys(progress || {}).length) {
        try {
            const get = Storage.prototype.getItem;
            const previous = JSON.parse(get.call(localStorage, 'fuckseats_onboarding_v3') || 'null');
            const finished = get.call(localStorage, 'fuckseats_onboarding_v3_completed') === '1' || previous?.finished === true;
            if (finished || (previous && typeof previous === 'object' && !Array.isArray(previous) && typeof previous.page === 'string')) {
                legacy = {...previous, page:previous?.page || 'ready', finished, returning:!!(previous?.returning || boot.returning)};
            }
        } catch (_) {}
    }
    if (legacy) {
        window.FUCKSEATS_ONBOARDING_ACTIVE = true;
        write(legacy);
        store.ready = flush().then(() => { window.FUCKSEATS_ONBOARDING_ACTIVE = false; route(); }).catch(() => { report(); route(); });
    } else route();
    window.addEventListener('pagehide',()=>{flush().catch(()=>{});});
})();
