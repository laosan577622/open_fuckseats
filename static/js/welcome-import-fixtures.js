/* Transport for the shared import UI. It only returns built-in teaching data. */
window.WelcomeImportFixtures = (() => {
    const grades = [['姓名','学号','班级','性别','分数','身高'],['张明','001','三年一班','男',92,172],['李华','002','三年一班','女',86,165],['陈晨','003','三年一班','男',95,170],['王悦','004','三年一班','女',88,168],['平均分','','','',90.25,'']];
    const seating = [['讲台','空位','空位'],['张明','李华','走廊'],['陈晨','王悦','走廊'],['空位','空位','走廊']];
    const students = ['张明','李华','陈晨','王悦'];
    function respond(kind, form, selected) {
        const action=form.get('action');
        if(action==='discard')return {status:'success'};
        if(!selected)throw new Error('请先在“班管理”窗口选择模拟文件。');
        if(kind==='import') {
            if(action==='confirm') {
                if(form.get('name_col_index')!=='0'||form.get('student_id_col_index')!=='1'||form.get('score_col_index')!=='4')throw new Error('本次练习请将姓名绑定到 A 列、学号绑定到 B 列、分数绑定到 E 列。点击“返回修改”即可调整。');
                if(form.get('start_row')!=='2'||form.get('end_row')!=='5')throw new Error('第 1 行是表头，第 6 行是平均分。请在预览中选中第 2 至 5 行，仅导入四位学生。');
                return {status:'success',message:'已完成四位模拟学生的导入，真实班级未发生变化。'};
            }
            return {status:'ready',file_id:'welcome-grades',file_name:'期中成绩表（模拟）.xlsx',sheet_name:'期中成绩',sheet_names:['期中成绩'],preview_data:structuredClone(grades),total_rows:6,total_cols:6,preview_rows:6,preview_cols:6,suggested:{start_row:2}};
        }
        const start=Math.max(1,Math.min(4,Number(form.get('start_row'))||1));
        const end=Math.max(start,Math.min(4,Number(form.get('end_row'))||4));
        const direction=form.get('layout_transform')||'none';
        if(action==='confirm' && (start!==1||end!==4||direction!=='none'))throw new Error('本次练习保留第 1 至 4 行和原始方向，让讲台在前。调整后点击“更新预览”核对。');
        const auto=action==='upload'||form.get('auto_detect_names')==='1';
        const terms=key=>(form.get(key)||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean);
        let rows=seating.slice(start-1,end).map(row=>row.map(label=>{
            let cell_type='seat';
            if(label==='讲台'||terms('manual_podium_terms').includes(label))cell_type='podium';
            else if(label==='走廊'||terms('manual_aisle_terms').includes(label))cell_type='aisle';
            else if(label==='空位'||terms('manual_empty_terms').includes(label))cell_type='empty';
            return {label,cell_type,named:cell_type==='seat'&&((auto&&students.includes(label))||terms('manual_name_terms').includes(label))};
        }));
        if(['flip_ud','rotate_180'].includes(direction))rows.reverse();
        if(['flip_lr','rotate_180'].includes(direction))rows.forEach(row=>row.reverse());
        const stats={seat:0,podium:0,empty:0,aisle:0,named:0};rows.flat().forEach(cell=>{stats[cell.cell_type]++;if(cell.named)stats.named++;});
        if(action==='confirm'&&stats.named!==4)throw new Error('本次示例应识别出四位学生。请启用自动姓名识别，或手动标记四位学生姓名，再更新预览。');
        const preview=rows.map((cells,i)=>({row_index:i+1,cells}));
        return {status:action==='confirm'?'success':'ready',message:action==='confirm'?'模拟导入完成，真实班级未发生变化。':'已识别模拟座位表，请检查范围、讲台位置和姓名数量。',file_id:'welcome-layout',start_row:start,end_row:end,bounds:{min_row:1,max_row:4},layout_transform:direction,grid_rows:rows.length,grid_cols:3,stats,front_preview:preview.slice(0,2),back_preview:preview.slice(-2)};
    }
    return {respond};
})();
