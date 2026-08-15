document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('import-students-root');
    if (!root) return;

    const importForm = document.getElementById('excel-import-form');
    const fileInput = document.getElementById('student-import-file');
    const fileNameLabel = document.getElementById('student-import-file-name');
    const mappingPanel = document.getElementById('import-mapping-panel');
    const uploadPanel = document.getElementById('student-import-upload-panel');
    const cancelBtn = document.getElementById('student-import-cancel-btn');
    const remapBtn = document.getElementById('student-import-remap-btn');
    const confirmBtn = document.getElementById('student-import-confirm-btn');
    const regionPanel = document.getElementById('student-import-region-panel');
    const regionStatus = document.getElementById('student-import-region-status');
    const regionTruncated = document.getElementById('student-import-region-truncated');
    const regionStartInput = document.getElementById('student-import-region-start');
    const regionEndInput = document.getElementById('student-import-region-end');
    const regionBackBtn = document.getElementById('student-import-region-back-btn');
    const finalConfirmBtn = document.getElementById('student-import-final-confirm-btn');
    const regionLegend = document.getElementById('student-import-region-legend');
    const regionFirstStudent = document.getElementById('student-import-region-first');
    const regionLastStudent = document.getElementById('student-import-region-last');
    const importSidebar = root.querySelector('.student-import-sidebar');
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
    const customNameInput = document.getElementById('student-import-custom-name');
    const customAddBtn = document.getElementById('student-import-custom-add-btn');
    const customList = document.getElementById('student-import-custom-list');

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
        classroom: { label: '班级', requestKey: 'classroom_col_index' },
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
    let customFieldCounter = 0;
    let isRegionConfirming = false;
    let selectedRegionStart = 1;
    let selectedRegionEnd = 1;
    let regionSelectionStage = 'start';
    let regionSelectionComplete = false;
    let fieldMappings = {
        name: null,
        studentId: null,
        classroom: null,
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

    const updateRegionStatus = () => {
        if (!regionStatus) return;
        if (regionSelectionStage === 'start') {
            regionStatus.textContent = `当前为第 ${selectedRegionStart} 至 ${selectedRegionEnd} 行，请单击开始行`;
            return;
        }
        if (regionSelectionStage === 'end') {
            regionStatus.textContent = `开始行已选为第 ${selectedRegionStart} 行，请单击结束行`;
            return;
        }
        regionStatus.textContent = `已确认第 ${selectedRegionStart} 至 ${selectedRegionEnd} 行`;
    };

    const syncRegionInputs = () => {
        if (regionStartInput) regionStartInput.value = String(selectedRegionStart);
        if (regionEndInput) regionEndInput.value = String(selectedRegionEnd);
    };

    const updateTruncationNotice = () => {
        if (!regionTruncated) return;
        const rowsTruncated = currentTotalRows > currentImportData.length;
        const colsTruncated = currentTotalCols > currentPreviewCols;
        if (!rowsTruncated && !colsTruncated) {
            regionTruncated.hidden = true;
            regionTruncated.textContent = '';
            return;
        }
        const parts = [];
        if (rowsTruncated) {
            parts.push(`文件共 ${currentTotalRows} 行，预览仅显示前 ${currentImportData.length} 行，超出的行可直接在下方输入行号选中`);
        }
        if (colsTruncated) {
            parts.push(`文件共 ${currentTotalCols} 列，预览仅显示前 ${currentPreviewCols} 列`);
        }
        regionTruncated.textContent = parts.join('；') + '。';
        regionTruncated.hidden = false;
    };

    const applyManualRegion = (which) => {
        const total = Math.max(currentTotalRows || currentImportData.length || 1, 1);
        const readInput = (input) => {
            const parsed = Number.parseInt(String(input.value || ''), 10);
            if (!Number.isFinite(parsed)) return null;
            return Math.max(1, Math.min(total, parsed));
        };
        const startValue = readInput(regionStartInput);
        const endValue = readInput(regionEndInput);
        if (startValue === null && endValue === null) return;
        if (which === 'start' && startValue !== null) {
            selectedRegionStart = startValue;
            selectedRegionEnd = Math.max(startValue, endValue === null ? selectedRegionEnd : endValue);
        } else if (which === 'end' && endValue !== null) {
            selectedRegionEnd = endValue;
            selectedRegionStart = Math.min(endValue, startValue === null ? selectedRegionStart : startValue);
        } else if (startValue !== null && endValue !== null) {
            selectedRegionStart = Math.min(startValue, endValue);
            selectedRegionEnd = Math.max(startValue, endValue);
        }
        regionSelectionStage = 'complete';
        regionSelectionComplete = true;
        syncRegionInputs();
        updateFinalConfirmState();
        updateRegionStatus();
        renderRegionStudents();
        renderPreview();
    };

    const findRegionStudentRow = (fromStart) => {
        const firstIndex = Math.max(selectedRegionStart - 1, 0);
        const lastIndex = Math.min(selectedRegionEnd - 1, currentImportData.length - 1);
        if (lastIndex < firstIndex) return null;
        const indexes = [];
        if (fromStart) {
            for (let index = firstIndex; index <= lastIndex; index += 1) indexes.push(index);
        } else {
            for (let index = lastIndex; index >= firstIndex; index -= 1) indexes.push(index);
        }
        for (const index of indexes) {
            const row = currentImportData[index];
            const nameValue = Array.isArray(row) && fieldMappings.name !== null
                ? String(row[fieldMappings.name] ?? '').trim()
                : '';
            if (nameValue && !['姓名', 'name'].includes(nameValue.toLowerCase())) {
                return { row, rowNumber: index + 1 };
            }
        }
        return null;
    };

    const renderRegionStudent = (target, studentRow, rowNumber, beyondPreview) => {
        if (!target) return;
        if (beyondPreview) {
            target.innerHTML = `<strong>第 ${rowNumber} 行</strong><small>超出预览显示范围，导入时仍会包含</small>`;
            return;
        }
        if (!studentRow) {
            target.innerHTML = '<strong>未识别到学生数据</strong>';
            return;
        }
        const mappedFields = Object.keys(fieldConfig).filter((field) =>
            Number.isInteger(fieldMappings[field])
        );
        const name = String(studentRow.row[fieldMappings.name] ?? '').trim() || `第 ${studentRow.rowNumber} 行`;
        const details = mappedFields
            .filter((field) => field !== 'name')
            .map((field) => {
                const value = String(studentRow.row[fieldMappings[field]] ?? '').trim() || '未填写';
                return `<span><b>${escapeHtml(fieldConfig[field].label)}</b>${escapeHtml(value)}</span>`;
            })
            .join('');
        target.innerHTML = `
            <strong>${escapeHtml(name)}</strong>
            <small>第 ${studentRow.rowNumber} 行</small>
            <div>${details}</div>
        `;
    };

    const renderRegionStudents = () => {
        const previewRowCount = currentImportData.length;
        const firstBeyond = selectedRegionStart > previewRowCount;
        const lastBeyond = selectedRegionEnd > previewRowCount;
        renderRegionStudent(
            regionFirstStudent,
            firstBeyond ? null : findRegionStudentRow(true),
            selectedRegionStart,
            firstBeyond
        );
        renderRegionStudent(
            regionLastStudent,
            lastBeyond ? null : findRegionStudentRow(false),
            selectedRegionEnd,
            lastBeyond
        );
    };

    const updateFinalConfirmState = () => {
        if (!finalConfirmBtn) return;
        finalConfirmBtn.classList.toggle('is-incomplete', !regionSelectionComplete);
        finalConfirmBtn.setAttribute('aria-disabled', regionSelectionComplete ? 'false' : 'true');
    };

    const setRegionConfirming = (enabled) => {
        isRegionConfirming = Boolean(enabled);
        root.classList.toggle('is-region-confirming', isRegionConfirming);
        if (uploadPanel) uploadPanel.hidden = isRegionConfirming;
        if (mappingPanel) mappingPanel.hidden = isRegionConfirming || !currentImportFileId;
        if (regionPanel) regionPanel.hidden = !isRegionConfirming;
        if (regionLegend) regionLegend.hidden = !isRegionConfirming;

    if (isRegionConfirming) {
        activeField = null;
        selectedRegionStart = getStartRow();
        selectedRegionEnd = Math.max(
            selectedRegionStart,
            Math.min(currentTotalRows || currentImportData.length || selectedRegionStart, currentTotalRows || selectedRegionStart)
        );
        regionSelectionStage = 'complete';
        regionSelectionComplete = true;
    }
    syncRegionInputs();
    updateTruncationNotice();
    updateFinalConfirmState();
        updateRegionStatus();
        renderRegionStudents();
        renderMappingState();
        renderPreview();
        if (isRegionConfirming) {
            window.requestAnimationFrame(() => {
                if (importSidebar) importSidebar.scrollTop = 0;
                regionPanel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                regionPanel?.focus({ preventScroll: true });
            });
        }
    };

    const selectRegionBoundary = (rowNumber) => {
        if (!isRegionConfirming) return;
        if (regionSelectionStage === 'start') {
            selectedRegionStart = rowNumber;
            selectedRegionEnd = Math.max(rowNumber, selectedRegionEnd);
            regionSelectionStage = 'end';
            regionSelectionComplete = false;
        } else if (regionSelectionStage === 'end') {
            const firstBoundary = selectedRegionStart;
            selectedRegionStart = Math.min(firstBoundary, rowNumber);
            selectedRegionEnd = Math.max(firstBoundary, rowNumber);
            regionSelectionStage = 'complete';
            regionSelectionComplete = true;
        } else {
            selectedRegionStart = rowNumber;
            selectedRegionEnd = rowNumber;
            regionSelectionStage = 'end';
            regionSelectionComplete = false;
        }
        updateFinalConfirmState();
        updateRegionStatus();
        syncRegionInputs();
        renderRegionStudents();
        renderPreview();
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

    const renderCustomFields = () => {
        if (!customList) return;
        const customFields = Object.keys(fieldConfig).filter((field) => fieldConfig[field].custom);
        customList.innerHTML = customFields.map((field) => `
            <div class="student-import-field-row">
                <button type="button" class="student-import-field-btn" data-import-field="${field}">
                    <span>${escapeHtml(fieldConfig[field].label)}</span>
                    <strong id="student-import-map-${field}">未选择</strong>
                </button>
                <button type="button" class="student-import-field-clear" data-clear-field="${field}" aria-label="清除${escapeHtml(fieldConfig[field].label)}列">
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>
                </button>
                <button type="button" class="student-import-custom-remove" data-remove-custom="${field}" aria-label="删除${escapeHtml(fieldConfig[field].label)}">删除</button>
            </div>
        `).join('');
        renderMappingState();
    };

    const addCustomField = (label, columnIndex = null) => {
        const normalizedLabel = String(label || '').trim();
        if (!normalizedLabel) return null;
        const duplicate = Object.keys(fieldConfig).find((field) =>
            fieldConfig[field].custom && fieldConfig[field].label === normalizedLabel
        );
        if (duplicate) {
            if (columnIndex !== null) fieldMappings[duplicate] = columnIndex;
            renderCustomFields();
            return duplicate;
        }
        customFieldCounter += 1;
        const field = `custom_${customFieldCounter}`;
        fieldConfig[field] = {
            label: normalizedLabel.slice(0, 80),
            custom: true
        };
        fieldMappings[field] = Number.isInteger(columnIndex) ? columnIndex : null;
        renderCustomFields();
        return field;
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
        Object.keys(fieldConfig).forEach((field) => {
            if (fieldConfig[field].custom) delete fieldConfig[field];
        });
        fieldMappings = {
            name: null,
            studentId: null,
            classroom: null,
            gender: null,
            score: null
        };
        activeField = null;
        renderCustomFields();
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

        const startRow = isRegionConfirming ? selectedRegionStart : getStartRow();
        const endRow = isRegionConfirming ? selectedRegionEnd : currentTotalRows;
        const tableClass = isRegionConfirming ? ' is-region-confirming' : '';
        let html = `<table class="student-import-sheet${tableClass}" aria-label="Excel 工作表预览"><thead><tr>`;
        html += `<th class="student-import-sheet-corner${isRegionConfirming ? ' region-invalid' : ''}" scope="col">行</th>`;
        for (let columnIndex = 0; columnIndex < currentPreviewCols; columnIndex += 1) {
            const mappedField = mappedFieldForColumn(columnIndex);
            const regionClass = isRegionConfirming
                ? (mappedField ? ' region-valid' : ' region-invalid')
                : '';
            const fieldClass = mappedField ? ` mapped field-${mappedField}` : '';
            const badge = mappedField
                ? `<span class="student-import-column-badge">${fieldConfig[mappedField].label}</span>`
                : '';
            const columnActionLabel = activeField
                ? `将 ${columnLabel(columnIndex)} 列设为${fieldConfig[activeField].label}`
                : `设置 ${columnLabel(columnIndex)} 列绑定`;
            html += `<th class="student-import-column-head${fieldClass}${regionClass}" scope="col">
                <button type="button" data-import-column="${columnIndex}" aria-label="${columnActionLabel}"${isRegionConfirming ? ' disabled' : ''}>
                    <span>${columnLabel(columnIndex)}</span>${badge}
                </button>
            </th>`;
        }
        html += '</tr></thead><tbody>';

        currentImportData.forEach((row, rowIndex) => {
            const rowNumber = rowIndex + 1;
            const isStartRow = rowNumber === startRow;
            const isEndRow = isRegionConfirming && rowNumber === endRow;
            const isSelectedRow = isRegionConfirming && rowNumber >= startRow && rowNumber <= endRow;
            const rowClass = isRegionConfirming
                ? `${isSelectedRow ? ' selected-data-row' : ' invalid-data-row'}${isStartRow ? ' data-start-row' : ''}${isEndRow ? ' data-end-row' : ''}`
                : (isStartRow ? ' data-start-row' : (rowNumber < startRow ? ' before-data-row' : ''));
            html += `<tr class="${rowClass.trim()}">`;
            html += `<th class="student-import-row-head${isRegionConfirming ? (isSelectedRow ? ' region-valid' : ' region-invalid') : ''}" scope="row">
                <button type="button" data-import-row="${rowNumber}" aria-label="${isRegionConfirming ? `选择第 ${rowNumber} 行作为数据边界` : `从第 ${rowNumber} 行开始导入`}">${rowNumber}</button>
            </th>`;
            for (let columnIndex = 0; columnIndex < currentPreviewCols; columnIndex += 1) {
                const mappedField = mappedFieldForColumn(columnIndex);
                const cellClass = mappedField ? ` mapped field-${mappedField}` : '';
                const regionClass = isRegionConfirming
                    ? (isSelectedRow && mappedField ? ' region-valid' : ' region-invalid')
                    : '';
                const value = Array.isArray(row) ? row[columnIndex] : '';
                html += `<td class="${`${cellClass}${regionClass}`.trim()}" data-import-cell="true" data-import-cell-row="${rowNumber}" data-import-cell-column="${columnIndex}" title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
            }
            html += '</tr>';
        });
        html += '</tbody></table>';
        previewArea.innerHTML = html;
    };

    let lastSheetOptions = [];
    const renderSheetSelect = (sheetNames, selectedSheet) => {
        if (!sheetSelect) return;
        lastSheetOptions = (sheetNames || []).slice();
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
                classroom: suggested.classroom_col_index,
                gender: suggested.gender_col_index,
                score: suggested.score_col_index
            };
            Object.keys(suggestedMappings).forEach((field) => {
                const value = suggestedMappings[field];
                if (Number.isInteger(value) && value >= 0 && value < currentTotalCols) {
                    fieldMappings[field] = value;
                }
            });
            (suggested.custom_columns || []).forEach((item) => {
                const value = Number(item?.col);
                if (item?.key && Number.isInteger(value) && value >= 0 && value < currentTotalCols) {
                    addCustomField(item.key, value);
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
            // 失败时保留下拉原有选项，允许用户重试而不是重新上传文件。
            renderSheetSelect(lastSheetOptions.length ? lastSheetOptions : [currentSheetName], currentSheetName);
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
        if (isRegionConfirming) setRegionConfirming(false);
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
        if (uploadPanel) uploadPanel.hidden = false;
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

    customAddBtn?.addEventListener('click', () => {
        const label = customNameInput?.value || '';
        if (!label.trim()) {
            notify('请输入自定义信息名称');
            customNameInput?.focus();
            return;
        }
        const field = addCustomField(label);
        if (customNameInput) customNameInput.value = '';
        setActiveField(field);
    });

    customNameInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        customAddBtn?.click();
    });

    customList?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-custom]');
        if (removeButton) {
            const field = removeButton.dataset.removeCustom;
            if (activeField === field) activeField = null;
            delete fieldConfig[field];
            delete fieldMappings[field];
            renderCustomFields();
            renderPreview();
            return;
        }
        const clearButton = event.target.closest('[data-clear-field]');
        if (clearButton) {
            const field = clearButton.dataset.clearField;
            if (fieldConfig[field]) {
                fieldMappings[field] = null;
                setActiveField(field);
            }
            return;
        }
        const fieldButton = event.target.closest('[data-import-field]');
        if (fieldButton) {
            setActiveField(fieldButton.dataset.importField, { toggle: true });
        }
    });

    rowMinusBtn?.addEventListener('click', () => setStartRow(getStartRow() - 1));
    rowPlusBtn?.addEventListener('click', () => setStartRow(getStartRow() + 1));
    startRowInput?.addEventListener('input', () => setStartRow(getStartRow()));

    sheetSelect?.addEventListener('change', () => {
        loadSheet(sheetSelect.value);
    });

    previewArea?.addEventListener('click', (event) => {
        const rowButton = event.target.closest('[data-import-row]');
        if (rowButton) {
            const rowNumber = Number(rowButton.dataset.importRow);
            if (isRegionConfirming) {
                selectRegionBoundary(rowNumber);
                return;
            }
            if (activeField === null) {
                openRowGuide(rowNumber);
            } else {
                setStartRow(rowNumber);
            }
            return;
        }
        const cell = event.target.closest('[data-import-cell]');
        if (cell) {
            if (!isRegionConfirming) openCellGuide();
            return;
        }
        const columnTarget = event.target.closest('[data-import-column]');
        if (columnTarget) {
            if (isRegionConfirming) return;
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

    confirmBtn?.addEventListener('click', () => {
        if (!currentImportFileId) {
            notify('请先打开 Excel 文件');
            return;
        }
        if (fieldMappings.name === null) {
            notify('请选择姓名列');
            setActiveField('name');
            return;
        }
        setHint('');
        setRegionConfirming(true);
    });

    regionBackBtn?.addEventListener('click', () => {
        setRegionConfirming(false);
    });

    [regionStartInput, regionEndInput].forEach((input, index) => {
        if (!input) return;
        const which = index === 0 ? 'start' : 'end';
        input.addEventListener('change', () => applyManualRegion(which));
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyManualRegion(which);
                input.blur();
            }
        });
    });

    finalConfirmBtn?.addEventListener('click', async () => {
        if (!currentImportFileId) {
            notify('导入文件已失效，请返回修改并重新打开文件');
            return;
        }
        if (!regionSelectionComplete) {
            notify('请再单击一个行标确认结束行');
            return;
        }
        const originalText = finalConfirmBtn.textContent;
        finalConfirmBtn.textContent = '导入中...';
        finalConfirmBtn.disabled = true;
        setHint('正在导入...');
        const formData = new FormData();
        formData.append('action', 'confirm');
        formData.append('file_id', currentImportFileId);
        formData.append('sheet_name', currentSheetName);
        formData.append('start_row', String(selectedRegionStart));
        formData.append('end_row', String(selectedRegionEnd));
        formData.append('import_mode', getImportMode());
        const customColumns = [];
        Object.keys(fieldConfig).forEach((field) => {
            const value = fieldMappings[field];
            if (value === null) return;
            if (fieldConfig[field].custom) {
                customColumns.push({ key: fieldConfig[field].label, col: value });
            } else {
                formData.append(fieldConfig[field].requestKey, String(value));
            }
        });
        formData.append('custom_columns', JSON.stringify(customColumns));

        try {
            const data = await postFormData(formData);
            setHint(data.message || '导入成功');
            currentImportFileId = '';
            markImportReturn();
            window.setTimeout(() => {
                window.location.href = backUrl;
            }, 220);
        } catch (error) {
            setHint('');
            notify(error?.message || '导入失败');
        } finally {
            finalConfirmBtn.textContent = originalText;
            finalConfirmBtn.disabled = false;
            updateFinalConfirmState();
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
