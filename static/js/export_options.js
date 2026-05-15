document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('export-options-root');
    if (!root) return;

    const confirmBtn = document.getElementById('export-options-confirm-btn');
    const cancelBtn = document.getElementById('export-options-cancel-btn');
    const hint = document.getElementById('export-options-hint');

    const kind = root.dataset.kind || '';
    const isSvgLike = kind === 'svg' || kind === 'pptx';
    const exportUrl = root.dataset.exportUrl || '';
    const previewStudentUrl = root.dataset.previewStudentUrl || '';
    const backUrl = root.dataset.backUrl || '/';
    const defaultFilename = root.dataset.defaultFilename || '导出文件';
    const acceptMime = root.dataset.acceptMime || '';
    const acceptExtensions = (root.dataset.acceptExt || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => (item.startsWith('.') ? item : `.${item}`));
    const notify = (message) => {
        if (!message) return;
        if (typeof window.showToast === 'function') {
            window.showToast(message);
            return;
        }
        console.warn(message);
    };

    const exitPage = () => {
        window.location.href = backUrl;
    };

    const resetColumnScrollTop = () => {
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }
        window.scrollTo(0, 0);
        requestAnimationFrame(() => {
            document.querySelectorAll('.options-left, .options-right').forEach((panel) => {
                panel.scrollTop = 0;
            });
        });
    };

    const setHint = (text) => {
        if (!hint) return;
        hint.textContent = text || '';
    };
    const exportBridge = window.FuckSeatsDesktop || {};

    const saveExportFromUrl = async (url, options = {}) => {
        if (typeof exportBridge.saveExportFromUrl === 'function') {
            return exportBridge.saveExportFromUrl(url, options);
        }
        throw new Error('导出桥接未加载');
    };

    const buildUrlWithQuery = (url, query = {}) => {
        const parsed = new URL(url, window.location.origin);
        Object.entries(query).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') {
                parsed.searchParams.delete(key);
            } else {
                parsed.searchParams.set(key, `${value}`);
            }
        });
        return `${parsed.pathname}${parsed.search}`;
    };

    const getChecked = (id) => {
        const element = document.getElementById(id);
        return element && element.checked ? '1' : '0';
    };

    const buildExcelExport = () => {
        const layoutTransform = document.querySelector('input[name="excel-export-layout-transform"]:checked')?.value || 'none';
        const query = {
            layout_transform: layoutTransform === 'rotate_180' ? 'rotate_180' : ''
        };
        let filename = defaultFilename;
        if (layoutTransform === 'rotate_180') {
            filename = /\.xlsx$/i.test(filename)
                ? filename.replace(/\.xlsx$/i, '_180度翻转.xlsx')
                : `${filename}_180度翻转.xlsx`;
        }
        return {
            url: buildUrlWithQuery(exportUrl, query),
            filename
        };
    };

    const buildSvgExport = () => {
        const query = {
            theme: document.querySelector('input[name="svg-export-theme"]:checked')?.value || 'classic',
            show_title: getChecked('svg-export-show-title'),
            show_podium: getChecked('svg-export-show-podium'),
            show_coords: getChecked('svg-export-show-coords'),
            show_name: getChecked('svg-export-show-name'),
            show_score: getChecked('svg-export-show-score'),
            show_group: getChecked('svg-export-show-group'),
            show_empty_label: getChecked('svg-export-show-empty-label'),
            show_seat_type: getChecked('svg-export-show-seat-type')
        };
        return {
            url: buildUrlWithQuery(exportUrl, query),
            filename: defaultFilename
        };
    };

    const renderExcelPreview = () => {
        if (kind !== 'excel') return;
        const payload = buildExcelExport();
        const layoutTransform = document.querySelector('input[name="excel-export-layout-transform"]:checked')?.value || 'none';
        const orientationLabel = layoutTransform === 'rotate_180' ? '180°翻转（讲台在下）' : '原始方向（讲台在上）';
        const orientationEl = document.getElementById('excel-preview-orientation');
        const filenameEl = document.getElementById('excel-preview-filename');
        if (orientationEl) orientationEl.textContent = orientationLabel;
        if (filenameEl) filenameEl.textContent = payload.filename;
    };

    const renderSvgPreview = () => {
        if (!isSvgLike) return;
        const theme = document.querySelector('input[name="svg-export-theme"]:checked')?.value || 'classic';
        const themeLabelMap = {
            classic: '经典蓝',
            minimal: '简洁灰',
            contrast: '高对比'
        };
        const styleMap = {
            classic: {
                bg: '#f7faff',
                title: '#0f172a',
                name: '#111827',
                sub: '#667085',
                type: '#475467',
                podiumFill: '#e7efff',
                podiumStroke: '#c9dbff',
                seatFillOccupied: '#eef4ff',
                seatStrokeOccupied: '#bfd4ff',
                seatFillEmpty: '#f8fbff',
                seatStrokeEmpty: '#d3e1ff',
                nonseatAisle: '#eff3f8',
                nonseatStroke: '#d0d5dd',
                tagText: '#ffffff',
                groupPalette: ['#0a59f7', '#00a38c', '#ff8b00', '#e45193']
            },
            minimal: {
                bg: '#f8fafc',
                title: '#1f2937',
                name: '#111827',
                sub: '#6b7280',
                type: '#4b5563',
                podiumFill: '#edf2f7',
                podiumStroke: '#d2dae6',
                seatFillOccupied: '#f9fafb',
                seatStrokeOccupied: '#cbd5e1',
                seatFillEmpty: '#ffffff',
                seatStrokeEmpty: '#d1d5db',
                nonseatAisle: '#f1f5f9',
                nonseatStroke: '#d1d5db',
                tagText: '#ffffff',
                groupPalette: ['#0a59f7', '#64748b', '#0f766e', '#b45309']
            },
            contrast: {
                bg: '#0b1220',
                title: '#e5ecff',
                name: '#ffffff',
                sub: '#b7c7e9',
                type: '#d2dbf5',
                podiumFill: '#1c2f5d',
                podiumStroke: '#33509c',
                seatFillOccupied: '#172a55',
                seatStrokeOccupied: '#3b5db7',
                seatFillEmpty: '#111b34',
                seatStrokeEmpty: '#30477f',
                nonseatAisle: '#1d2a44',
                nonseatStroke: '#2e426f',
                tagText: '#ffffff',
                groupPalette: ['#0a59f7', '#0fa968', '#f59e0b', '#ef4444']
            }
        };
        const enabledFields = [];
        if (getChecked('svg-export-show-title') === '1') enabledFields.push('标题');
        if (getChecked('svg-export-show-podium') === '1') enabledFields.push('讲台');
        if (getChecked('svg-export-show-coords') === '1') enabledFields.push('坐标');
        if (getChecked('svg-export-show-name') === '1') enabledFields.push('姓名');
        if (getChecked('svg-export-show-score') === '1') enabledFields.push('成绩');
        if (getChecked('svg-export-show-group') === '1') enabledFields.push('小组');
        if (getChecked('svg-export-show-empty-label') === '1') enabledFields.push('空座');
        if (getChecked('svg-export-show-seat-type') === '1') enabledFields.push('类型');

        const themeEl = document.getElementById('svg-preview-theme');
        const fieldsEl = document.getElementById('svg-preview-fields');
        const livePreviewEl = document.getElementById('svg-live-preview');

        if (themeEl) themeEl.textContent = themeLabelMap[theme] || theme;
        if (fieldsEl) fieldsEl.textContent = enabledFields.length ? enabledFields.join('、') : '无';
        if (!livePreviewEl) return;

        const sample = window.__svgPreviewSample || {};
        const style = styleMap[theme] || styleMap.classic;
        const showTitle = getChecked('svg-export-show-title') === '1';
        const showPodium = getChecked('svg-export-show-podium') === '1';
        const showCoords = getChecked('svg-export-show-coords') === '1';
        const showName = getChecked('svg-export-show-name') === '1';
        const showScore = getChecked('svg-export-show-score') === '1';
        const showGroup = getChecked('svg-export-show-group') === '1';
        const showEmptyLabel = getChecked('svg-export-show-empty-label') === '1';
        const showSeatType = getChecked('svg-export-show-seat-type') === '1';
        const nameEmphasis = showName && !showCoords && !showScore;

        const width = 500;
        const height = 260;
        const titleY = 28;
        const podiumY = showTitle ? 36 : 16;
        const seatY = showPodium ? 78 : 56;
        const groupColor = style.groupPalette[(sample.groupIndex || 0) % style.groupPalette.length];
        const nameFontSize = (text) => {
            const length = Math.max(1, String(text || '').length);
            let size = 30 - length * 2;
            if (size < 16) size = 16;
            if (size > 26) size = 26;
            return size;
        };
        const safe = (text) => String(text || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

        const chunks = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
            '<style><![CDATA[',
            '.t{font-family:"鸿蒙黑体";font-size:20px;}',
            '.n{font-family:"鸿蒙黑体";font-size:16px;}',
            '.s{font-family:"鸿蒙黑体 Light";font-size:12px;}',
            '.k{font-family:"鸿蒙黑体";font-size:11px;}',
            '.c{font-family:"鸿蒙黑体";font-size:13px;}',
            ']]></style>',
            `<rect x="0" y="0" width="${width}" height="${height}" fill="${style.bg}"/>`
        ];

        if (showTitle) {
            chunks.push(`<text x="20" y="${titleY}" class="t" fill="${style.title}">${safe(sample.classroom || '示例班级')} 座次图</text>`);
        }

        if (showPodium) {
            chunks.push(`<rect x="160" y="${podiumY}" width="180" height="30" rx="10" fill="${style.podiumFill}" stroke="${style.podiumStroke}"/>`);
            chunks.push(`<text x="250" y="${podiumY + 20}" text-anchor="middle" class="c" fill="${style.type}">讲台</text>`);
        }

        chunks.push(`<rect x="20" y="${seatY}" width="200" height="120" rx="16" fill="${style.seatFillOccupied}" stroke="${style.seatStrokeOccupied}"/>`);
        if (showCoords) {
            chunks.push(`<text x="30" y="${seatY + 18}" class="s" fill="${style.sub}">(${safe(sample.coord || '1-1')})</text>`);
        }
        if (showGroup) {
            chunks.push(`<rect x="154" y="${seatY + 8}" width="56" height="20" rx="10" fill="${groupColor}"/>`);
            chunks.push(`<text x="182" y="${seatY + 22}" text-anchor="middle" class="k" fill="${style.tagText}">${safe(sample.group || '未分组')}</text>`);
        }
        if (showName) {
            const rawName = String(sample.name || '随机学生');
            const nameText = safe(rawName);
            if (nameEmphasis) {
                const fontSize = nameFontSize(rawName);
                const centerY = seatY + (showGroup ? 66 : 60);
                chunks.push(`<text x="120" y="${centerY}" text-anchor="middle" dominant-baseline="middle" class="n" font-size="${fontSize}" fill="${style.name}">${nameText}</text>`);
            } else {
                chunks.push(`<text x="34" y="${seatY + (showCoords ? 58 : 46)}" class="n" fill="${style.name}">${nameText}</text>`);
            }
        }
        if (showScore) {
            chunks.push(`<text x="34" y="${seatY + (showCoords ? 80 : 68)}" class="s" fill="${style.sub}">${safe(sample.score || 90)}分</text>`);
        }

        chunks.push(`<rect x="240" y="${seatY}" width="120" height="120" rx="16" fill="${style.seatFillEmpty}" stroke="${style.seatStrokeEmpty}"/>`);
        if (showEmptyLabel) {
            chunks.push(`<text x="254" y="${seatY + 66}" class="s" fill="${style.sub}">空座位</text>`);
        }
        chunks.push(`<rect x="380" y="${seatY}" width="100" height="120" rx="16" fill="${style.nonseatAisle}" stroke="${style.nonseatStroke}"/>`);
        if (showSeatType) {
            chunks.push(`<text x="430" y="${seatY + 66}" text-anchor="middle" class="c" fill="${style.type}">走廊</text>`);
        }

        chunks.push('</svg>');
        livePreviewEl.innerHTML = chunks.join('');
    };

    const setFallbackSvgSample = () => {
        window.__svgPreviewSample = {
            classroom: '预览班级',
            name: '暂无学生',
            score: '',
            group: '',
            groupIndex: 0,
            coord: ''
        };
    };

    const fetchRandomSvgSample = async () => {
        if (!previewStudentUrl) {
            setFallbackSvgSample();
            return;
        }
        try {
            const response = await fetch(previewStudentUrl, {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.status === 'error') {
                throw new Error(data.message || '获取预览学生失败');
            }
            if (data.status === 'empty') {
                setFallbackSvgSample();
                return;
            }
            const sample = data.sample || {};
            window.__svgPreviewSample = {
                classroom: sample.classroom || '预览班级',
                name: sample.name || '未命名学生',
                score: sample.score || '',
                group: sample.group || '',
                groupIndex: Number(sample.group_index || 0),
                coord: sample.coord || ''
            };
        } catch (_) {
            setFallbackSvgSample();
        }
    };

    const bindSvgPreviewRandomButton = () => {
        const randomBtn = document.getElementById('svg-preview-random-btn');
        if (!randomBtn) return;
        randomBtn.addEventListener('click', async () => {
            if (randomBtn.dataset.pending === '1') return;
            randomBtn.dataset.pending = '1';
            const originalText = randomBtn.textContent;
            randomBtn.textContent = '加载中...';
            randomBtn.disabled = true;
            await fetchRandomSvgSample();
            renderSvgPreview();
            randomBtn.textContent = originalText;
            randomBtn.disabled = false;
            randomBtn.dataset.pending = '';
        });
    };

    resetColumnScrollTop();
    if (isSvgLike) {
        if (!window.__svgPreviewSample) {
            setFallbackSvgSample();
        }
    }

    const getExportPayload = () => {
        if (kind === 'excel') return buildExcelExport();
        if (isSvgLike) return buildSvgExport();
        return { url: exportUrl, filename: defaultFilename };
    };

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            exitPage();
        });
    }

    if (kind === 'excel') {
        document.querySelectorAll('input[name="excel-export-layout-transform"]').forEach((input) => {
            input.addEventListener('change', renderExcelPreview);
        });
        renderExcelPreview();
    }

    if (isSvgLike) {
        document.querySelectorAll('input[name="svg-export-theme"], #svg-export-show-title, #svg-export-show-podium, #svg-export-show-coords, #svg-export-show-name, #svg-export-show-score, #svg-export-show-group, #svg-export-show-empty-label, #svg-export-show-seat-type')
            .forEach((element) => {
                element.addEventListener('change', renderSvgPreview);
            });
        bindSvgPreviewRandomButton();
        fetchRandomSvgSample().finally(renderSvgPreview);
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            if (confirmBtn.dataset.pending === '1') return;
            const payload = getExportPayload();
            if (!payload.url) {
                notify('导出地址无效');
                return;
            }

            confirmBtn.dataset.pending = '1';
            confirmBtn.dataset.prevText = confirmBtn.textContent || '开始导出';
            confirmBtn.textContent = '导出中...';
            confirmBtn.disabled = true;
            setHint('正在导出，请稍候...');

            try {
                const result = await saveExportFromUrl(payload.url, {
                    fallbackFilename: payload.filename,
                    acceptMime,
                    acceptExtensions
                });
                if (result.status === 'cancelled') {
                    setHint('已取消保存。');
                    return;
                }
                setHint(`导出成功：${result.filename}，正在返回...`);
                setTimeout(exitPage, 220);
            } catch (error) {
                setHint('');
                notify(error?.message || '导出失败');
            } finally {
                confirmBtn.dataset.pending = '';
                confirmBtn.textContent = confirmBtn.dataset.prevText || '开始导出';
                confirmBtn.disabled = false;
            }
        });
    }
});
