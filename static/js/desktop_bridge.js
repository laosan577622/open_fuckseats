(function () {
    const APP_SHELL = document.body?.dataset.appShell || 'browser';

    const sanitizeFilename = (name, fallback = '导出文件') => {
        const normalized = String(name || '')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/[. ]+$/g, '')
            .trim();
        return normalized || fallback;
    };

    const parseContentDispositionFilename = (contentDisposition) => {
        if (!contentDisposition) return '';
        const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        if (utf8Match && utf8Match[1]) {
            try {
                return decodeURIComponent(utf8Match[1]);
            } catch (_) {
                return utf8Match[1];
            }
        }
        const plainMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
        if (!plainMatch) return '';
        return (plainMatch[1] || plainMatch[2] || '').trim();
    };

    const inferFilenameFromUrl = (url, fallback = '导出文件') => {
        try {
            const parsed = new URL(url, window.location.origin);
            const lastPart = parsed.pathname.split('/').filter(Boolean).pop() || '';
            if (!lastPart) return fallback;
            if (lastPart.includes('.')) return lastPart;
        } catch (_) {
        }
        return fallback;
    };

    const normalizeAcceptExtensions = (raw = [], fallbackFilename = '') => {
        const source = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [];
        const normalized = [];
        source.forEach((item) => {
            const value = String(item || '').trim();
            if (!value) return;
            const withDot = value.startsWith('.') ? value : `.${value}`;
            if (!normalized.includes(withDot)) {
                normalized.push(withDot);
            }
        });
        if (normalized.length) return normalized;
        const match = String(fallbackFilename || '').match(/(\.[A-Za-z0-9]{1,10})$/);
        return match ? [match[1]] : [];
    };

    const buildSavePickerTypes = (mime, extensions, filename) => {
        const extList = [...(extensions || [])];
        if (!extList.length && filename.includes('.')) {
            const suffix = filename.slice(filename.lastIndexOf('.'));
            if (suffix && suffix.length <= 10) extList.push(suffix);
        }
        if (!extList.length) return [];
        return [{
            description: '导出文件',
            accept: {
                [mime || 'application/octet-stream']: extList
            }
        }];
    };

    const triggerBrowserDownload = (blob, filename) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            link.remove();
        }, 1000);
    };

    const openSaveFileHandle = async (filename, mime, extensions) => {
        if (!window.isSecureContext || typeof window.showSaveFilePicker !== 'function') return null;
        const pickerOptions = { suggestedName: filename };
        const types = buildSavePickerTypes(mime, extensions, filename);
        if (types.length) pickerOptions.types = types;
        return window.showSaveFilePicker(pickerOptions);
    };

    const waitForDesktopApi = async (requiredMethod = 'save_export') => {
        const readyApi = window.pywebview?.api;
        if (readyApi && typeof readyApi[requiredMethod] === 'function') {
            return readyApi;
        }
        if (APP_SHELL !== 'webview') {
            return null;
        }
        return await new Promise((resolve) => {
            let settled = false;
            const cleanup = () => window.removeEventListener('pywebviewready', handleReady);
            const finish = (api) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(api);
            };
            const handleReady = () => {
                const api = window.pywebview?.api;
                finish(api && typeof api[requiredMethod] === 'function' ? api : null);
            };
            window.addEventListener('pywebviewready', handleReady, { once: true });
            setTimeout(() => {
                const api = window.pywebview?.api;
                finish(api && typeof api[requiredMethod] === 'function' ? api : null);
            }, 2500);
        });
    };

    const saveExportFromUrl = async (url, options = {}) => {
        if (!url) throw new Error('导出地址无效');

        const fallbackFilename = sanitizeFilename(
            options.fallbackFilename || inferFilenameFromUrl(url),
            '导出文件'
        );
        const acceptMime = options.acceptMime || '';
        const acceptExtensions = normalizeAcceptExtensions(options.acceptExtensions || [], fallbackFilename);

        const desktopApi = await waitForDesktopApi('save_export');
        if (desktopApi) {
            const result = await desktopApi.save_export(url, fallbackFilename, acceptMime, acceptExtensions);
            if (!result || typeof result !== 'object') {
                throw new Error('桌面导出失败');
            }
            if (result.status === 'error') {
                throw new Error(result.message || '桌面导出失败');
            }
            if (!result.filename) {
                result.filename = fallbackFilename;
            }
            return result;
        }

        let fileHandle = null;
        try {
            fileHandle = await openSaveFileHandle(fallbackFilename, acceptMime, acceptExtensions);
        } catch (error) {
            if (error?.name === 'AbortError') {
                return { status: 'cancelled', filename: fallbackFilename };
            }
        }

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin'
        });
        if (!response.ok) {
            throw new Error(`导出失败（${response.status}）`);
        }

        const headerFilename = parseContentDispositionFilename(response.headers.get('Content-Disposition') || '');
        const finalFilename = sanitizeFilename(headerFilename || fallbackFilename, fallbackFilename);
        const blob = await response.blob();

        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { status: 'saved', filename: finalFilename };
        }

        triggerBrowserDownload(blob, finalFilename);
        return { status: 'downloaded', filename: finalFilename };
    };

    const uploadLocalFile = async (url, options = {}) => {
        const desktopApi = await waitForDesktopApi('upload_local_file');
        if (!desktopApi) return null;

        const acceptExtensions = normalizeAcceptExtensions(
            options.acceptExtensions || [],
            options.fallbackFilename || 'import.seats'
        );
        const result = await desktopApi.upload_local_file(
            url,
            options.csrf || '',
            options.fieldName || 'file',
            acceptExtensions
        );
        if (!result || typeof result !== 'object') {
            throw new Error('桌面导入失败');
        }
        if (result.status === 'error') {
            throw new Error(result.message || '桌面导入失败');
        }
        return result;
    };

    const importSeatsFile = async (url, options = {}) => {
        return uploadLocalFile(url, {
            ...options,
            fieldName: 'seats_file',
            fallbackFilename: 'import.seats',
            acceptExtensions: options.acceptExtensions || ['.seats', '.json']
        });
    };

    window.FuckSeatsDesktop = {
        saveExportFromUrl,
        importSeatsFile,
        uploadLocalFile,
        parseAcceptExtensions: (raw) => normalizeAcceptExtensions(raw)
    };
})();
