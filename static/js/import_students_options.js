document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('import-students-root');
    if (!root) return;

    const importForm = document.getElementById('excel-import-form');
    const mappingPanel = document.getElementById('import-mapping-panel');
    const cancelBtn = document.getElementById('student-import-cancel-btn');
    const remapBtn = document.getElementById('student-import-remap-btn');
    const confirmBtn = document.getElementById('student-import-confirm-btn');
    const hint = document.getElementById('student-import-hint');

    const startRowInput = document.getElementById('import-start-row');
    const nameColSelect = document.getElementById('import-name-col');
    const scoreColSelect = document.getElementById('import-score-col');
    const previewArea = document.getElementById('import-preview-area');
    const stageText = document.getElementById('student-import-stage');
    const modePreview = document.getElementById('student-import-mode-preview');

    const importUrl = root.dataset.importUrl || '';
    const backUrl = root.dataset.backUrl || '/';

    let currentImportData = null;
    let currentImportFileId = null;

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

    const escapeHtml = (text) => {
        return String(text ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    };

    const getImportMode = () => {
        const checked = importForm?.querySelector('input[name="import_mode"]:checked');
        return checked ? checked.value : 'match';
    };

    const updateModePreview = () => {
        if (!modePreview) return;
        modePreview.textContent = getImportMode() === 'replace' ? '清空后全量导入' : '匹配更新';
    };

    resetColumnScrollTop();

    const resetMapping = () => {
        currentImportData = null;
        currentImportFileId = null;
        if (mappingPanel) mappingPanel.style.display = 'none';
    };

    const updateColumnSelects = () => {
        if (!currentImportData || !nameColSelect || !scoreColSelect || !startRowInput) return;
        const startRowIdx = Math.max(0, (parseInt(startRowInput.value, 10) || 1) - 1);
        if (startRowIdx >= currentImportData.length) return;

        const headerRow = currentImportData[startRowIdx];
        nameColSelect.innerHTML = '<option value="">请选择列</option>';
        scoreColSelect.innerHTML = '<option value="">不导入分数</option>';

        headerRow.forEach((value, idx) => {
            const displayValue = value !== null && value !== undefined ? String(value).substring(0, 20) : `(列 ${idx + 1})`;
            const option = `<option value="${idx}">列 ${idx + 1}: ${escapeHtml(displayValue)}</option>`;
            nameColSelect.innerHTML += option;
            scoreColSelect.innerHTML += option;
        });

        headerRow.forEach((value, idx) => {
            const normalized = String(value || '').trim().toLowerCase();
            if (normalized.includes('姓名') || normalized.includes('name')) {
                nameColSelect.value = `${idx}`;
            }
            if (normalized === '总分' || normalized === '学生总分') {
                scoreColSelect.value = `${idx}`;
            }
        });
    };

    const updatePreview = () => {
        if (!currentImportData || !previewArea || !startRowInput || !nameColSelect || !scoreColSelect) return;
        const startRowIdx = Math.max(0, (parseInt(startRowInput.value, 10) || 1) - 1);
        const nameColIdx = nameColSelect.value;
        const scoreColIdx = scoreColSelect.value;

        if (nameColIdx === '') {
            previewArea.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">请至少选择“姓名列”</div>';
            return;
        }

        const rows = [];
        for (let i = startRowIdx + 1; i < currentImportData.length && rows.length < 2; i += 1) {
            rows.push(currentImportData[i]);
        }
        if (!rows.length) {
            previewArea.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">没有更多数据行</div>';
            return;
        }

        let html = '<table class="preview-table"><thead><tr><th>姓名 (预览)</th><th>总分 (预览)</th></tr></thead><tbody>';
        rows.forEach((row) => {
            const name = row[nameColIdx] !== undefined ? row[nameColIdx] : '';
            const score = scoreColIdx !== '' && row[scoreColIdx] !== undefined ? row[scoreColIdx] : '-';
            html += `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(score)}</td></tr>`;
        });
        html += '</tbody></table>';
        previewArea.innerHTML = html;
    };

    const showMapping = (data) => {
        currentImportData = data.preview_data || [];
        currentImportFileId = data.file_id || '';
        if (mappingPanel) mappingPanel.style.display = '';
        if (startRowInput) startRowInput.value = 1;
        updateColumnSelects();
        updatePreview();
    };

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            exitPage();
        });
    }

    if (remapBtn) {
        remapBtn.addEventListener('click', () => {
            resetMapping();
            setHint('请重新选择文件上传。');
        });
    }

    importForm?.querySelectorAll('input[name="import_mode"]').forEach((input) => {
        input.addEventListener('change', updateModePreview);
    });
    updateModePreview();

    if (startRowInput) {
        startRowInput.addEventListener('change', () => {
            updateColumnSelects();
            updatePreview();
        });
    }
    if (nameColSelect) {
        nameColSelect.addEventListener('change', updatePreview);
    }
    if (scoreColSelect) {
        scoreColSelect.addEventListener('change', updatePreview);
    }

    if (importForm) {
        importForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const uploadBtn = document.getElementById('student-import-upload-btn');
            const originalText = uploadBtn ? uploadBtn.textContent : '';
            if (uploadBtn) {
                uploadBtn.textContent = '处理中...';
                uploadBtn.disabled = true;
            }
            setHint('正在上传并解析文件...');

            const formData = new FormData(importForm);
            const csrf = importForm.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';

            try {
                const response = await fetch(importForm.action || importUrl, {
                    method: 'POST',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRFToken': csrf
                    },
                    body: formData
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.message || '导入失败');
                }

                if (data.status === 'success') {
                    setHint(`${data.message || '导入成功'}，正在返回...`);
                    setTimeout(exitPage, 220);
                    return;
                }
                if (data.status === 'ambiguous') {
                    showMapping(data);
                    setHint(data.message || '请手动匹配列');
                    return;
                }
                throw new Error(data.message || '导入失败');
            } catch (error) {
                setHint('');
                alert(error?.message || '导入失败');
            } finally {
                if (uploadBtn) {
                    uploadBtn.textContent = originalText;
                    uploadBtn.disabled = false;
                }
            }
        });
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            if (!currentImportFileId) {
                alert('缺少临时文件，请重新上传');
                return;
            }
            if (!nameColSelect || nameColSelect.value === '') {
                alert('请选择姓名列');
                return;
            }
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = '导入中...';
            confirmBtn.disabled = true;
            setHint('正在导入，请稍候...');

            const formData = new FormData();
            formData.append('action', 'confirm');
            formData.append('file_id', currentImportFileId);
            formData.append('start_row', Math.max(0, (parseInt(startRowInput?.value || '1', 10) || 1) - 1));
            formData.append('name_col_index', nameColSelect.value);
            formData.append('import_mode', getImportMode());
            if (scoreColSelect && scoreColSelect.value !== '') {
                formData.append('score_col_index', scoreColSelect.value);
            }

            const csrf = importForm?.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
            try {
                const response = await fetch(importUrl, {
                    method: 'POST',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRFToken': csrf
                    },
                    body: formData
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.status !== 'success') {
                    throw new Error(data.message || '导入失败');
                }
                setHint(`${data.message || '导入成功'}，正在返回...`);
                setTimeout(exitPage, 220);
            } catch (error) {
                setHint('');
                alert(error?.message || '导入失败');
            } finally {
                confirmBtn.textContent = originalText;
                confirmBtn.disabled = false;
            }
        });
    }
});
