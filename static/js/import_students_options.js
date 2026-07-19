document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('import-students-root');
    if (!root) return;

    const importForm = document.getElementById('excel-import-form');
    const fileInput = document.getElementById('student-import-file');
    const fileNameLabel = document.getElementById('student-import-file-name');
    const mappingPanel = document.getElementById('import-mapping-panel');
    const cancelBtn = document.getElementById('student-import-cancel-btn');
    const remapBtn = document.getElementById('student-import-remap-btn');
    const confirmBtn = document.getElementById('student-import-confirm-btn');
    const startRowInput = document.getElementById('import-start-row');
    const rowMinusBtn = document.getElementById('student-import-row-minus');
    const rowPlusBtn = document.getElementById('student-import-row-plus');
    const sheetSelect = document.getElementById('student-import-sheet');
    const previewArea = document.getElementById('import-preview-area');
    const previewMeta = document.getElementById('student-import-preview-meta');
    const stageText = document.getElementById('student-import-stage');
    const hint = document.getElementById('student-import-hint');
    const guideModal = document.getElementById('student-import-guide-modal');
    const guideTitle = document.getElementById('student-import-guide-title');
    const guideMessage = document.getElementById('student-import-guide-message');
    const guideOptions = document.getElementById('student-import-guide-options');
    const guideCloseBtn = document.getElementById('student-import-guide-close');
    const guideConfirmBtn = document.getElementById('student-import-guide-confirm');

    const importUrl = root.dataset.importUrl || '';
    const backUrl = root.dataset.backUrl || '/';
    const classroomId = root.dataset.classroomId || '';
    const importReturnSyncKey = classroomId ? `fuckseats_cloud_import_return_${classroomId}` : '';
    const markImportReturn = () => {
        if (!importReturnSyncKey) return;
        try {
            sessionStorage.setItem(importReturnSyncKey, '1');
        } catch (error) {
            // 浏览器禁用存储时，显式返回 URL 仍可跳过本次入口同步。
        }
    };
    const fieldConfig = {
        name: { label: '姓名', requestKey: 'name_col_index' },
        studentId: { label: '学号', requestKey: 'student_id_col_index' },
        gender: { label: '性别', requestKey: 'gender_col_index' },
        score: { label: '分数', requestKey: 'score_col_index' }
    };

    let currentImportFileId = '';
    let currentFileName = '';
    let currentSheetName = '';
    let currentImportData = [];
    let currentTotalRows = 0;
    let currentTotalCols = 0;
    let currentPreviewRows = 0;
    let currentPreviewCols = 0;
    let activeField = null;
    let guideLastFocused = null;
    let fieldMappings = {
        name: null,
        studentId: null,
        gender: null,
        score: null
    };

    const notify = (message) => {
        if (!message) return;
        if (typeof window.showToast === 'function') {
            window.showToast(message);
            return;
        }
        console.warn(message);
    };

    const setHint = (text) => {
        if (hint) hint.textContent = text || '';
    };

    const escapeHtml = (text) => String(text ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    const columnLabel = (columnIndex) => {
        let number = Number(columnIndex) + 1;
        let label = '';
        while (number > 0) {
            const remainder = (number - 1) % 26;
            label = String.fromCharCode(65 + remainder) + label;
            number = Math.floor((number - 1) / 26);
        }
        return label;
    };

    const getImportMode = () => {
        const selected = document.querySelector('input[name="import_mode"]:checked');
        return selected?.value || 'match';
    };

    const getStartRow = () => {
        const parsed = Number.parseInt(startRowInput?.value || '1', 10);
        return Math.min(Math.max(parsed || 1, 1), Math.max(currentTotalRows, 1));
    };

    const setStartRow = (value) => {
        if (!startRowInput) return;
        const max = Math.max(currentTotalRows, 1);
        startRowInput.value = String(Math.min(Math.max(Number(value) || 1, 1), max));
        renderPreview();
    };

    const mappedFieldForColumn = (columnIndex) => {
        return Object.keys(fieldMappings).find((field) => fieldMappings[field] === columnIndex) || null;
    };

    const renderMappingState = () => {
        Object.keys(fieldConfig).forEach((field) => {
            const mappingValue = fieldMappings[field];
            const label = document.getElementById(`student-import-map-${field}`);
            const fieldButton = document.querySelector(`[data-import-field="${field}"]`);
            const clearButton = document.querySelector(`[data-clear-field="${field}"]`);
            if (label) {
                label.textContent = mappingValue === null ? '未选择' : `${columnLabel(mappingValue)} 列`;
            }
            if (fieldButton) {
                fieldButton.classList.toggle('active', activeField === field);
                fieldButton.classList.toggle('mapped', mappingValue !== null);
                fieldButton.setAttribute('aria-pressed', activeField === field ? 'true' : 'false');
            }
            if (clearButton) {
                clearButton.disabled = mappingValue === null;
            }
        });
    };

    const setActiveField = (field, options = {}) => {
        if (field !== null && !fieldConfig[field]) return;
        activeField = options.toggle && activeField === field ? null : field;
        renderMappingState();
        renderPreview();
    };

    const closeGuideModal = () => {
        if (!guideModal || guideModal.hidden) return;
        guideModal.hidden = true;
        document.body.classList.remove('student-import-guide-open');
        if (guideLastFocused?.isConnected) guideLastFocused.focus();
        guideLastFocused = null;
    };

    const openGuideModal = ({ title, message, options = [] }) => {
        if (!guideModal || !guideTitle || !guideMessage || !guideOptions || !guideConfirmBtn) return;
        guideLastFocused = document.activeElement;
        guideTitle.textContent = title;
        guideMessage.textContent = message;
        guideOptions.replaceChildren();

        options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'student-import-guide-option';
            button.textContent = option.label;
            button.addEventListener('click', () => {
                option.action();
                closeGuideModal();
            });
            guideOptions.appendChild(button);
        });

        guideOptions.hidden = options.length === 0;
        guideConfirmBtn.hidden = options.length > 0;
        guideModal.hidden = false;
        document.body.classList.add('student-import-guide-open');
        window.requestAnimationFrame(() => {
            const firstTarget = guideOptions.querySelector('button') || guideConfirmBtn || guideCloseBtn;
            firstTarget?.focus();
        });
    };

    const openColumnGuide = (columnIndex) => {
        openGuideModal({
            title: `标记 ${columnLabel(columnIndex)} 列`,
            message: '请选择这一列对应的字段',
            options: Object.keys(fieldConfig).map((field) => ({
                label: fieldConfig[field].label,
                action: () => assignFieldToColumn(field, columnIndex)
            }))
        });
    };

    const openRowGuide = (rowNumber) => {
        openGuideModal({
            title: `标记第 ${rowNumber} 行`,
            message: '请选择这一行的用途',
            options: [{
                label: '数据开始行',
                action: () => setStartRow(rowNumber)
            }]
        });
    };

    const openCellGuide = () => {
        openGuideModal({
            title: '请点击行号或列标',
            message: '绑定行请点击表格最左侧的行号，绑定列请点击表格最上方的列标。'
        });
    };

    const assignFieldToColumn = (field, columnIndex) => {
        if (!fieldConfig[field] || columnIndex < 0 || columnIndex >= currentTotalCols) return;
        Object.keys(fieldMappings).forEach((candidateField) => {
            if (candidateField !== field && fieldMappings[candidateField] === columnIndex) {
                fieldMappings[candidateField] = null;
            }
        });
        fieldMappings[field] = columnIndex;
        renderMappingState();
        renderPreview();
    };

    const resetMappings = () => {
        fieldMappings = {
            name: null,
            studentId: null,
            gender: null,
            score: null
        };
        activeField = null;
        renderMappingState();
    };

    const renderEmptyPreview = (label = '等待选择文件') => {
        if (!previewArea) return;
        previewArea.innerHTML = `
            <div class="student-import-empty-state">
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M17 7h22l10 10v40H17z"></path>
                    <path d="M39 7v11h10M23 30h20M23 38h20M23 46h13"></path>
                </svg>
                <span>${escapeHtml(label)}</span>
            </div>`;
    };

    const renderPreview = () => {
        if (!previewArea) return;
        if (!currentImportData.length || currentPreviewCols < 1) {
            renderEmptyPreview('当前工作表为空');
            return;
        }

        const startRow = getStartRow();
        let html = '<table class="student-import-sheet" aria-label="Excel 工作表预览"><thead><tr>';
        html += '<th class="student-import-sheet-corner" scope="col">行</th>';
        for (let columnIndex = 0; columnIndex < currentPreviewCols; columnIndex += 1) {
            const mappedField = mappedFieldForColumn(columnIndex);
            const fieldClass = mappedField ? ` mapped field-${mappedField}` : '';
            const badge = mappedField
                ? `<span class="student-import-column-badge">${fieldConfig[mappedField].label}</span>`
                : '';
            const columnActionLabel = activeField
                ? `将 ${columnLabel(columnIndex)} 列设为${fieldConfig[activeField].label}`
                : `设置 ${columnLabel(columnIndex)} 列绑定`;
            html += `<th class="student-import-column-head${fieldClass}" scope="col">
                <button type="button" data-import-column="${columnIndex}" aria-label="${columnActionLabel}">
                    <span>${columnLabel(columnIndex)}</span>${badge}
                </button>
            </th>`;
        }
        html += '</tr></thead><tbody>';

        currentImportData.forEach((row, rowIndex) => {
            const rowNumber = rowIndex + 1;
            const isStartRow = rowNumber === startRow;
            const rowClass = isStartRow ? ' data-start-row' : (rowNumber < startRow ? ' before-data-row' : '');
            html += `<tr class="${rowClass.trim()}">`;
            html += `<th class="student-import-row-head" scope="row">
                <button type="button" data-import-row="${rowNumber}" aria-label="从第 ${rowNumber} 行开始导入">${rowNumber}</button>
            </th>`;
            for (let columnIndex = 0; columnIndex < currentPreviewCols; columnIndex += 1) {
                const mappedField = mappedFieldForColumn(columnIndex);
                const cellClass = mappedField ? ` mapped field-${mappedField}` : '';
                const value = Array.isArray(row) ? row[columnIndex] : '';
                html += `<td class="${cellClass.trim()}" data-import-cell="true" data-import-cell-row="${rowNumber}" data-import-cell-column="${columnIndex}" title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
            }
            html += '</tr>';
        });
        html += '</tbody></table>';
        previewArea.innerHTML = html;
    };

    const renderSheetSelect = (sheetNames, selectedSheet) => {
        if (!sheetSelect) return;
        sheetSelect.innerHTML = (sheetNames || []).map((sheetName) => {
            const selected = sheetName === selectedSheet ? ' selected' : '';
            return `<option value="${escapeHtml(sheetName)}"${selected}>${escapeHtml(sheetName)}</option>`;
        }).join('');
        sheetSelect.disabled = (sheetNames || []).length <= 1;
    };

    const applyPreviewData = (data, options = {}) => {
        currentImportFileId = data.file_id || currentImportFileId;
        currentFileName = data.file_name || currentFileName;
        currentSheetName = data.sheet_name || '';
        currentImportData = Array.isArray(data.preview_data) ? data.preview_data : [];
        currentTotalRows = Number(data.total_rows) || 0;
        currentTotalCols = Number(data.total_cols) || 0;
        currentPreviewRows = Number(data.preview_rows) || currentImportData.length;
        currentPreviewCols = Number(data.preview_cols) || 0;

        renderSheetSelect(data.sheet_names || [], currentSheetName);
        if (mappingPanel) mappingPanel.hidden = false;
        if (startRowInput) {
            startRowInput.min = '1';
            startRowInput.max = String(Math.max(currentTotalRows, 1));
        }

        if (!options.keepMappings) {
            resetMappings();
            const suggested = data.suggested || {};
            setStartRow(suggested.start_row || 1);
            const suggestedMappings = {
                name: suggested.name_col_index,
                studentId: suggested.student_id_col_index,
                gender: suggested.gender_col_index,
                score: suggested.score_col_index
            };
            Object.keys(suggestedMappings).forEach((field) => {
                const value = suggestedMappings[field];
                if (Number.isInteger(value) && value >= 0 && value < currentTotalCols) {
                    fieldMappings[field] = value;
                }
            });
        }

        renderMappingState();
        renderPreview();
        if (stageText) {
            stageText.textContent = [currentFileName, currentSheetName].filter(Boolean).join(' · ');
        }
        if (fileNameLabel) fileNameLabel.textContent = currentFileName || '未选择文件';
        if (previewMeta) {
            const shownRows = Math.min(currentPreviewRows, currentTotalRows);
            const shownCols = Math.min(currentPreviewCols, currentTotalCols);
            previewMeta.textContent = currentTotalRows > shownRows || currentTotalCols > shownCols
                ? `${shownRows}/${currentTotalRows} 行 · ${shownCols}/${currentTotalCols} 列`
                : `${currentTotalRows} 行 · ${currentTotalCols} 列`;
        }
    };

    const postFormData = async (formData) => {
        const csrf = importForm?.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
        const response = await fetch(importUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrf
            },
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status === 'error') {
            throw new Error(data.message || '导入失败');
        }
        return data;
    };

    const loadSheet = async (sheetName) => {
        if (!currentImportFileId) return;
        sheetSelect.disabled = true;
        setHint('正在读取工作表...');
        const formData = new FormData();
        formData.append('action', 'preview');
        formData.append('file_id', currentImportFileId);
        formData.append('sheet_name', sheetName);
        try {
            const data = await postFormData(formData);
            applyPreviewData(data);
            setHint('');
        } catch (error) {
            setHint('');
            notify(error?.message || '读取失败');
            renderSheetSelect([currentSheetName], currentSheetName);
        } finally {
            if (sheetSelect) sheetSelect.disabled = sheetSelect.options.length <= 1;
        }
    };

    const discardImportFile = async () => {
        if (!currentImportFileId) return;
        const fileId = currentImportFileId;
        currentImportFileId = '';
        const formData = new FormData();
        formData.append('action', 'discard');
        formData.append('file_id', fileId);
        try {
            await postFormData(formData);
        } catch (error) {
            // 清理请求失败不阻断当前交互。
        }
    };

    const resetImport = () => {
        currentImportFileId = '';
        currentFileName = '';
        currentSheetName = '';
        currentImportData = [];
        currentTotalRows = 0;
        currentTotalCols = 0;
        currentPreviewRows = 0;
        currentPreviewCols = 0;
        resetMappings();
        if (mappingPanel) mappingPanel.hidden = true;
        if (previewMeta) previewMeta.textContent = '';
        if (stageText) stageText.textContent = '';
        if (fileInput) fileInput.value = '';
        if (fileNameLabel) fileNameLabel.textContent = '未选择文件';
        setHint('');
        renderEmptyPreview();
    };

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    cancelBtn?.addEventListener('click', async () => {
        markImportReturn();
        await discardImportFile();
        window.location.href = backUrl;
    });

    remapBtn?.addEventListener('click', async () => {
        await discardImportFile();
        resetImport();
        fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
        if (fileNameLabel) {
            fileNameLabel.textContent = fileInput.files?.[0]?.name || '未选择文件';
        }
    });

    document.querySelectorAll('[data-import-field]').forEach((button) => {
        button.addEventListener('click', () => setActiveField(button.dataset.importField, { toggle: true }));
    });

    document.querySelectorAll('[data-clear-field]').forEach((button) => {
        button.addEventListener('click', () => {
            const field = button.dataset.clearField;
            if (!fieldConfig[field]) return;
            fieldMappings[field] = null;
            setActiveField(field);
        });
    });

    rowMinusBtn?.addEventListener('click', () => setStartRow(getStartRow() - 1));
    rowPlusBtn?.addEventListener('click', () => setStartRow(getStartRow() + 1));
    startRowInput?.addEventListener('input', () => setStartRow(getStartRow()));

    sheetSelect?.addEventListener('change', () => {
        loadSheet(sheetSelect.value);
    });

    previewArea?.addEventListener('click', (event) => {
        const cell = event.target.closest('[data-import-cell]');
        if (cell) {
            openCellGuide();
            return;
        }
        const rowButton = event.target.closest('[data-import-row]');
        if (rowButton) {
            const rowNumber = Number(rowButton.dataset.importRow);
            if (activeField === null) {
                openRowGuide(rowNumber);
            } else {
                setStartRow(rowNumber);
            }
            return;
        }
        const columnTarget = event.target.closest('[data-import-column]');
        if (columnTarget) {
            const columnIndex = Number(columnTarget.dataset.importColumn);
            if (activeField === null) {
                openColumnGuide(columnIndex);
            } else {
                assignFieldToColumn(activeField, columnIndex);
            }
        }
    });

    guideCloseBtn?.addEventListener('click', closeGuideModal);
    guideConfirmBtn?.addEventListener('click', closeGuideModal);
    guideModal?.addEventListener('click', (event) => {
        if (event.target === guideModal) closeGuideModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !guideModal?.hidden) closeGuideModal();
    });

    importForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const uploadBtn = document.getElementById('student-import-upload-btn');
        const originalText = uploadBtn?.textContent || '';
        if (uploadBtn) {
            uploadBtn.textContent = '读取中...';
            uploadBtn.disabled = true;
        }
        await discardImportFile();
        setHint('正在读取文件...');

        const formData = new FormData(importForm);
        formData.set('action', 'upload');
        try {
            const data = await postFormData(formData);
            if (data.status !== 'ready') throw new Error(data.message || '读取失败');
            applyPreviewData(data);
            setHint('');
        } catch (error) {
            setHint('');
            notify(error?.message || '读取失败');
        } finally {
            if (uploadBtn) {
                uploadBtn.textContent = originalText;
                uploadBtn.disabled = false;
            }
        }
    });

    confirmBtn?.addEventListener('click', async () => {
        if (!currentImportFileId) {
            notify('请先打开 Excel 文件');
            return;
        }
        if (fieldMappings.name === null) {
            notify('请选择姓名列');
            setActiveField('name');
            return;
        }

        const originalText = confirmBtn.textContent;
        confirmBtn.textContent = '导入中...';
        confirmBtn.disabled = true;
        setHint('正在导入...');

        const formData = new FormData();
        formData.append('action', 'confirm');
        formData.append('file_id', currentImportFileId);
        formData.append('sheet_name', currentSheetName);
        formData.append('start_row', String(getStartRow()));
        formData.append('import_mode', getImportMode());
        Object.keys(fieldConfig).forEach((field) => {
            const value = fieldMappings[field];
            if (value !== null) formData.append(fieldConfig[field].requestKey, String(value));
        });

        try {
            const data = await postFormData(formData);
            setHint(data.message || '导入成功');
            markImportReturn();
            window.setTimeout(() => {
                window.location.href = backUrl;
            }, 220);
        } catch (error) {
            setHint('');
            notify(error?.message || '导入失败');
        } finally {
            confirmBtn.textContent = originalText;
            confirmBtn.disabled = false;
        }
    });

    window.addEventListener('pagehide', () => {
        if (!currentImportFileId || !navigator.sendBeacon) return;
        const formData = new FormData();
        formData.append('action', 'discard');
        formData.append('file_id', currentImportFileId);
        formData.append(
            'csrfmiddlewaretoken',
            importForm?.querySelector('input[name="csrfmiddlewaretoken"]')?.value || ''
        );
        navigator.sendBeacon(importUrl, formData);
    });

    renderMappingState();
});
