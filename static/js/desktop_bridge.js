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
        const plainFilename = (plainMatch[1] || plainMatch[2] || '').trim();
        try {
            return decodeURIComponent(plainFilename);
        } catch (_) {
            return plainFilename;
        }
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

    const nextAvailableFilename = (filename, usedNames) => {
        const normalized = sanitizeFilename(filename, '导出文件');
        const dotIndex = normalized.lastIndexOf('.');
        const stem = dotIndex > 0 ? normalized.slice(0, dotIndex) : normalized;
        const suffix = dotIndex > 0 ? normalized.slice(dotIndex) : '';
        let candidate = normalized;
        let index = 1;
        while (usedNames.has(candidate.toLocaleLowerCase())) {
            index += 1;
            candidate = `${stem} (${index})${suffix}`;
        }
        usedNames.add(candidate.toLocaleLowerCase());
        return candidate;
    };

    const nextAvailableDirectoryFilename = async (directoryHandle, filename, usedNames) => {
        let candidate = nextAvailableFilename(filename, usedNames);
        let index = 1;
        const dotIndex = candidate.lastIndexOf('.');
        const stem = dotIndex > 0 ? candidate.slice(0, dotIndex) : candidate;
        const suffix = dotIndex > 0 ? candidate.slice(dotIndex) : '';
        while (true) {
            try {
                await directoryHandle.getFileHandle(candidate);
                usedNames.delete(candidate.toLocaleLowerCase());
                index += 1;
                candidate = `${stem} (${index})${suffix}`;
                while (usedNames.has(candidate.toLocaleLowerCase())) {
                    index += 1;
                    candidate = `${stem} (${index})${suffix}`;
                }
                usedNames.add(candidate.toLocaleLowerCase());
            } catch (error) {
                if (error?.name === 'NotFoundError') return candidate;
                if (error?.name !== 'TypeMismatchError') throw error;
                usedNames.delete(candidate.toLocaleLowerCase());
                index += 1;
                candidate = `${stem} (${index})${suffix}`;
                while (usedNames.has(candidate.toLocaleLowerCase())) {
                    index += 1;
                    candidate = `${stem} (${index})${suffix}`;
                }
                usedNames.add(candidate.toLocaleLowerCase());
            }
        }
    };

    const saveExportsToDirectory = async (exports, options = {}) => {
        const exportItems = Array.isArray(exports)
            ? exports.filter((item) => item && typeof item === 'object' && item.url)
            : [];
        if (!exportItems.length) throw new Error('没有可导出的文件');

        // 浏览器端要在点击事件的同一调用栈中打开文件夹选择器，避免丢失用户手势。
        const desktopApi = APP_SHELL === 'webview'
            ? await waitForDesktopApi('save_exports_to_directory')
            : null;
        if (desktopApi) {
            const result = await desktopApi.save_exports_to_directory(
                exportItems,
                options.suggestedDirectoryName || ''
            );
            if (!result || typeof result !== 'object') {
                throw new Error('批量导出失败');
            }
            return result;
        }

        if (!window.isSecureContext || typeof window.showDirectoryPicker !== 'function') {
            throw new Error('当前浏览器不支持选择文件夹，请使用桌面版或通过 HTTPS 访问');
        }

        let directoryHandle;
        try {
            directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (error) {
            if (error?.name === 'AbortError') return { status: 'cancelled' };
            throw error;
        }

        const savedFiles = [];
        const usedNames = new Set();
        for (let index = 0; index < exportItems.length; index += 1) {
            const item = exportItems[index];
            const response = await fetch(item.url, {
                method: 'GET',
                credentials: 'same-origin'
            });
            if (!response.ok) {
                throw new Error(`导出失败（${response.status}）`);
            }

            const headerFilename = parseContentDispositionFilename(
                response.headers.get('Content-Disposition') || ''
            );
            const filename = await nextAvailableDirectoryFilename(
                directoryHandle,
                headerFilename || item.filename || inferFilenameFromUrl(item.url),
                usedNames
            );
            const writableFile = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await writableFile.createWritable();
            await writable.write(await response.blob());
            await writable.close();
            savedFiles.push({ filename });
            if (typeof options.onProgress === 'function') {
                options.onProgress({
                    completed: index + 1,
                    total: exportItems.length,
                    filename,
                });
            }
        }

        return {
            status: 'saved',
            directory_name: directoryHandle.name || '',
            files: savedFiles,
            count: savedFiles.length,
        };
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
        saveExportsToDirectory,
        importSeatsFile,
        uploadLocalFile,
        parseAcceptExtensions: (raw) => normalizeAcceptExtensions(raw)
    };
})();
