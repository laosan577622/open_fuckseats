document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('import-layout-root');
    if (!root) return;

    const uploadForm = document.getElementById('seat-layout-upload-form');
    const uploadBtn = document.getElementById('seat-layout-upload-btn');
    const previewBtn = document.getElementById('seat-layout-preview-btn');
    const confirmBtn = document.getElementById('seat-layout-confirm-btn');
    const cancelBtn = document.getElementById('layout-import-cancel-btn');
    const hint = document.getElementById('layout-import-hint');

    const importUrl = root.dataset.importUrl || '';
    const backUrl = root.dataset.backUrl || '/';

    let seatLayoutFileId = null;
    let seatLayoutTransform = 'none';

    const setHint = (text) => {
        if (!hint) return;
        hint.textContent = text || '';
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

    const escapeHtml = (text) => {
        return String(text ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    };

    const getTransformLabel = (transform) => {
        if (transform === 'flip_ud') return '上下翻转';
        if (transform === 'flip_lr') return '左右翻转';
        if (transform === 'rotate_180') return '180°旋转';
        return '原始方向';
    };

    const setTransform = (transform, silent = false) => {
        seatLayoutTransform = transform || 'none';
        document.querySelectorAll('.seat-layout-transform-btn').forEach((button) => {
            button.classList.toggle('active', button.dataset.layoutTransform === seatLayoutTransform);
        });
        if (!silent && seatLayoutFileId) {
            refreshPreview();
        }
    };

    const getOptions = (includeReplaceStudents = false) => {
        const options = {
            start_row: document.getElementById('seat-layout-start-row')?.value || '',
            end_row: document.getElementById('seat-layout-end-row')?.value || '',
            auto_detect_names: document.getElementById('seat-layout-auto-name')?.checked ? '1' : '0',
            manual_name_terms: document.getElementById('seat-layout-manual-names')?.value || '',
            manual_podium_terms: document.getElementById('seat-layout-manual-podium')?.value || '',
            manual_empty_terms: document.getElementById('seat-layout-manual-empty')?.value || '',
            manual_aisle_terms: document.getElementById('seat-layout-manual-aisle')?.value || '',
            layout_transform: seatLayoutTransform
        };
        if (includeReplaceStudents) {
            options.replace_students = document.getElementById('seat-layout-replace-students')?.checked ? '1' : '0';
        }
        return options;
    };

    const renderPreviewRows = (targetId, rows) => {
        const target = document.getElementById(targetId);
        if (!target) return;
        if (!rows || !rows.length) {
            target.innerHTML = '<div style="text-align:center; color: var(--text-secondary); padding: 14px;">暂无预览</div>';
            return;
        }
        let html = '<table class="preview-table seat-layout-preview-table"><tbody>';
        rows.forEach((row) => {
            html += `<tr><th>第${row.row_index}排</th>`;
            (row.cells || []).forEach((cell) => {
                html += `<td class="seat-layout-cell type-${cell.cell_type}">${escapeHtml(cell.label)}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        target.innerHTML = html;
    };

    const applyPreviewData = (data) => {
        if (!data) return;
        setTransform(data.layout_transform || seatLayoutTransform, true);
        if (data.file_id) {
            seatLayoutFileId = data.file_id;
            const fileIdInput = document.getElementById('seat-layout-file-id');
            if (fileIdInput) fileIdInput.value = data.file_id;
        }

        const config = document.getElementById('seat-layout-config');
        if (config) config.style.display = 'block';

        const startInput = document.getElementById('seat-layout-start-row');
        const endInput = document.getElementById('seat-layout-end-row');
        if (startInput) {
            startInput.value = data.start_row || '';
            if (data.bounds) {
                startInput.min = data.bounds.min_row;
                startInput.max = data.bounds.max_row;
            }
        }
        if (endInput) {
            endInput.value = data.end_row || '';
            if (data.bounds) {
                endInput.min = data.bounds.min_row;
                endInput.max = data.bounds.max_row;
            }
        }

        renderPreviewRows('seat-layout-front-preview', data.front_preview || []);
        renderPreviewRows('seat-layout-back-preview', data.back_preview || []);

        const stats = data.stats || {};
        const meta = document.getElementById('seat-layout-preview-meta');
        if (meta) {
            meta.textContent = `方向：${getTransformLabel(seatLayoutTransform)}；识别网格 ${data.grid_rows || 0} x ${data.grid_cols || 0}；座位 ${stats.seat || 0}，走廊 ${stats.aisle || 0}，讲台 ${stats.podium || 0}，空位 ${stats.empty || 0}，姓名 ${stats.named || 0}`;
        }
    };

    const sendImport = (action, includeReplaceStudents = false) => {
        if (!importUrl) {
            return Promise.reject(new Error('未找到导入接口'));
        }
        if (!seatLayoutFileId) {
            return Promise.reject(new Error('请先上传并识别座位表文件'));
        }
        const formData = new FormData();
        formData.append('action', action);
        formData.append('file_id', seatLayoutFileId);
        const options = getOptions(includeReplaceStudents);
        Object.keys(options).forEach((key) => {
            formData.append(key, options[key]);
        });

        const csrf = uploadForm?.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
        return fetch(importUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrf
            },
            body: formData
        }).then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.status === 'error') {
                throw new Error(data.message || '导入失败');
            }
            return data;
        });
    };

    const refreshPreview = () => {
        const originalText = previewBtn ? previewBtn.textContent : '';
        if (previewBtn) {
            previewBtn.textContent = '预览中...';
            previewBtn.disabled = true;
        }
        sendImport('preview')
            .then((data) => {
                applyPreviewData(data);
                setHint('预览已更新。');
            })
            .catch((error) => {
                setHint('');
                alert(error?.message || '预览失败');
            })
            .finally(() => {
                if (previewBtn) {
                    previewBtn.textContent = originalText;
                    previewBtn.disabled = false;
                }
            });
    };

    resetColumnScrollTop();

    document.querySelectorAll('.seat-layout-transform-btn').forEach((button) => {
        button.addEventListener('click', () => {
            setTransform(button.dataset.layoutTransform || 'none');
        });
    });

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            exitPage();
        });
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            seatLayoutFileId = null;
            setTransform('none', true);
            setHint('正在上传并识别文件...');

            const originalText = uploadBtn ? uploadBtn.textContent : '';
            if (uploadBtn) {
                uploadBtn.textContent = '识别中...';
                uploadBtn.disabled = true;
            }

            const formData = new FormData(uploadForm);
            formData.append('action', 'upload');
            const csrf = uploadForm.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';

            try {
                const response = await fetch(uploadForm.action || importUrl, {
                    method: 'POST',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRFToken': csrf
                    },
                    body: formData
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.message || '识别失败');
                }
                if (data.status !== 'ready') {
                    throw new Error(data.message || '识别失败');
                }
                applyPreviewData(data);
                setHint(data.message || '文件解析完成，请确认范围后导入。');
            } catch (error) {
                setHint('');
                alert(error?.message || '识别失败');
            } finally {
                if (uploadBtn) {
                    uploadBtn.textContent = originalText;
                    uploadBtn.disabled = false;
                }
            }
        });
    }

    if (previewBtn) {
        previewBtn.addEventListener('click', () => {
            refreshPreview();
        });
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = '导入中...';
            confirmBtn.disabled = true;
            setHint('正在导入，请稍候...');

            sendImport('confirm', true)
                .then((data) => {
                    setHint(`${data.message || '导入成功'}，正在返回...`);
                    setTimeout(exitPage, 220);
                })
                .catch((error) => {
                    setHint('');
                    alert(error?.message || '导入失败');
                })
                .finally(() => {
                    confirmBtn.textContent = originalText;
                    confirmBtn.disabled = false;
            });
        });
    }

    renderPreviewRows('seat-layout-front-preview', []);
    renderPreviewRows('seat-layout-back-preview', []);
});
