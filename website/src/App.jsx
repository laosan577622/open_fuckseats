import React, { useState, useEffect } from 'react';

// === Icons ===
const Icons = {
    Logo: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="2" fill="#0a59f7" />
            <rect x="14" y="3" width="7" height="7" rx="2" fill="#0a59f7" fillOpacity="0.7" />
            <rect x="3" y="14" width="7" height="7" rx="2" fill="#0a59f7" fillOpacity="0.7" />
            <rect x="14" y="14" width="7" height="7" rx="2" fill="#0a59f7" />
        </svg>
    ),
    ToastInfo: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a59f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
        </svg>
    ),
    Close: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
};

// === Data Helpers ===
const NAMES = [
    '张伟', '王芳', '李强', '赵敏', '刘洋', '陈杰', '杨洁', '黄磊', '周涛', '吴倩',
    '徐明', '孙丽', '朱华', '马超', '胡静', '郭伟', '何丽', '高飞', '林丹', '罗平',
    '梁伟', '宋佳', '郑强', '谢娜', '韩梅', '唐杰', '冯亮', '于敏', '董伟', '萧峰',
    '程刚', '曹丽', '袁华', '邓超', '许晴', '傅明', '沈腾', '曾志', '彭辉', '吕布',
    '苏灿', '蒋欣', '魏晨', '李响', '张萌', '王凯', '赵丽', '孙红'
];

const generateClassroom = () => {
    const seats = [];
    let studentIdx = 0;
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 8; c++) {
            if (c === 2 || c === 5) {
                seats.push({ type: 'aisle', id: `aisle-${r}-${c}`, r, c });
                continue;
            }
            if (studentIdx < NAMES.length) {
                seats.push({
                    type: 'seat',
                    id: `seat-${r}-${c}`, r, c,
                    name: NAMES[studentIdx],
                    score: Math.floor(Math.random() * 40 + 60),
                    group: null
                });
                studentIdx++;
            } else {
                seats.push({ type: 'empty', id: `empty-${r}-${c}`, r, c });
            }
        }
    }
    return seats;
};

// === Island Guide ===
const IslandGuide = ({ step, onAction }) => {
    const [isAnimating, setIsAnimating] = useState(false);

    const handleClick = () => {
        if (isAnimating) return;
        setIsAnimating(true);
        onAction();
        setTimeout(() => setIsAnimating(false), 600);
    };

    let width = 200;
    let content = null;

    switch (step) {
        case 0:
            width = 180;
            content = (
                <div className="island-inner loading">
                    <div className="spinner-mini" style={{ borderTopColor: 'white', borderRightColor: 'white' }}></div>
                    <span style={{ color: 'white', fontSize: '13px' }}>正在同步班级数据...</span>
                </div>
            );
            break;
        case 1:
            width = 260;
            content = (
                <div className="island-inner" onClick={handleClick}>
                    <div className="island-badge blue">数据就绪</div>
                    <span style={{ color: 'white', fontSize: '13px' }}>生成初始座位表</span>
                    <div className="island-arrow" style={{ color: 'white' }}>→</div>
                </div>
            );
            break;
        case 2:
            width = 280;
            content = (
                <div className="island-inner" onClick={handleClick}>
                    <div className="island-badge orange">发现问题</div>
                    <span style={{ color: 'white', fontSize: '13px' }}>成绩分布不均，优化排座？</span>
                    <div className="island-arrow" style={{ color: 'white' }}>→</div>
                </div>
            );
            break;
        case 3:
            width = 200;
            content = (
                <div className="island-inner loading">
                    <div className="spinner-mini" style={{ borderTopColor: 'white', borderRightColor: 'white' }}></div>
                    <span style={{ color: 'white', fontSize: '13px' }}>正在进行 S 型排序...</span>
                </div>
            );
            break;
        case 4:
            width = 280;
            content = (
                <div className="island-inner" onClick={handleClick}>
                    <div className="island-badge green">合作学习</div>
                    <span style={{ color: 'white', fontSize: '13px' }}>应用优差互补分组策略</span>
                    <div className="island-arrow" style={{ color: 'white' }}>→</div>
                </div>
            );
            break;
        case 5:
            width = 200;
            content = (
                <div className="island-inner loading">
                    <div className="spinner-mini" style={{ borderTopColor: 'white', borderRightColor: 'white' }}></div>
                    <span style={{ color: 'white', fontSize: '13px' }}>正在划分均衡小组...</span>
                </div>
            );
            break;
        case 6:
            width = 240;
            content = (
                <div className="island-inner" onClick={handleClick}>
                    <div className="island-badge blue">完成</div>
                    <span style={{ color: 'white', fontSize: '13px' }}>排座完美，导出文件</span>
                    <div className="island-arrow" style={{ color: 'white' }}>→</div>
                </div>
            );
            break;
        case 7:
            width = 220;
            content = (
                <div className="island-inner" style={{ justifyContent: 'center' }}>
                    <div style={{ background: '#27c93f', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px' }}>✓</div>
                    <span style={{ color: 'white', fontSize: '13px', fontWeight: 500 }}>已导出至桌面</span>
                </div>
            );
            break;
        default: break;
    }

    return (
        <div className="dynamic-island-container">
            <div className="dynamic-island" style={{ width, height: 44, transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {content}
            </div>
        </div>
    );
};

// === Seat Map ===
const SeatMap = ({ seats }) => {
    const groupColors = ['#FF5F56', '#FFBD2E', '#27C93F', '#007AFF', '#34C759', '#FF2D55', '#5856D6', '#FF9500'];
    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
            <div className="lectern">讲台</div>
            <div className="seat-grid" style={{ width: '100%' }}>
                {seats.map((seat) => {
                    if (seat.type === 'aisle') return <div key={seat.id} className="aisle"></div>;
                    if (seat.type === 'empty') return <div key={seat.id} className="seat empty" style={{ visibility: 'hidden' }}></div>;
                    const groupColor = seat.group !== null ? groupColors[seat.group % groupColors.length] : null;
                    return (
                        <div key={seat.id} className="seat occupied" style={{ borderColor: groupColor ? groupColor : 'rgba(0,0,0,0.05)', borderWidth: groupColor ? '2px' : '1px' }}>
                            {groupColor && <div className="seat-group-tag" style={{ backgroundColor: groupColor }}>{seat.group + 1}组</div>}
                            <div className="seat-avatar" style={{ background: groupColor ? `${groupColor}20` : '#f0f6ff', color: groupColor || '#0a59f7' }}>{seat.name[0]}</div>
                            <div className="seat-info">
                                <div className="seat-name">{seat.name}</div>
                                <div className="seat-score" style={{ color: seat.score < 70 ? '#ff5f56' : '#888' }}>{seat.score}分</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// === Interactive Demo ===
const InteractiveDemo = ({ onClose }) => {
    const [step, setStep] = useState(0);
    const [seats, setSeats] = useState([]);

    useEffect(() => {
        const timer = setTimeout(() => { setSeats(generateClassroom()); setStep(1); }, 1500);
        return () => clearTimeout(timer);
    }, []);

    const handleIslandAction = () => {
        if (step === 1) setStep(2);
        else if (step === 2) { setStep(3); setTimeout(() => { sortSeats(); setStep(4); }, 1500); }
        else if (step === 4) { setStep(5); setTimeout(() => { assignGroups(); setStep(6); }, 1500); }
        else if (step === 6) { setStep(7); setTimeout(() => { setStep(8); }, 2000); }
    };

    const restartDemo = () => { setStep(0); setTimeout(() => { setSeats(generateClassroom()); setStep(1); }, 1500); };

    const sortSeats = () => {
        setSeats(prev => {
            const occupied = prev.filter(s => s.type === 'seat');
            occupied.sort((a, b) => b.score - a.score);
            const newSeats = [...prev];
            let occIdx = 0;
            for (let i = 0; i < newSeats.length; i++) {
                if (newSeats[i].type === 'seat' || newSeats[i].type === 'empty') {
                    if (occIdx < occupied.length) {
                        const s = occupied[occIdx];
                        newSeats[i] = { ...s, r: newSeats[i].r, c: newSeats[i].c, id: newSeats[i].id, type: 'seat' };
                        occIdx++;
                    } else { newSeats[i] = { ...newSeats[i], type: 'empty' }; }
                }
            }
            return newSeats;
        });
    };

    const assignGroups = () => {
        setSeats(prev => {
            const newSeats = [...prev];
            newSeats.forEach(s => {
                if (s.type === 'seat') {
                    const rG = Math.floor(s.r / 2); const cG = s.c < 4 ? 0 : 1;
                    s.group = rG * 2 + cG;
                }
            });
            return newSeats;
        });
    };

    return (
        <div className="immersive-container">
            {step < 8 && <IslandGuide step={step} onAction={handleIslandAction} />}
            <div className="classroom-stage" style={{ overflowY: 'auto', position: 'relative' }}>
                {step === 0 ? (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                        <div className="spinner" style={{ borderColor: '#ddd', borderTopColor: '#0a59f7' }}></div>
                        <p style={{ marginTop: 20 }}>正在加载排座引擎...</p>
                    </div>
                ) : (<SeatMap seats={seats} />)}

                {step === 8 && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)',
                        zIndex: 20000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        animation: 'fadeIn 0.5s'
                    }}>
                        <div style={{
                            background: 'white', padding: '40px', borderRadius: '24px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.15)', textAlign: 'center',
                            maxWidth: '400px', width: '90%', border: '1px solid rgba(0,0,0,0.05)'
                        }}>
                            <div style={{ width: 60, height: 60, background: '#e1f5fe', borderRadius: '50%', color: '#0a59f7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '24px' }}>
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0a59f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                            </div>
                            <h2 style={{ fontSize: '24px', marginBottom: '10px', color: '#1d1d1f' }}>体验已结束</h2>
                            <p style={{ color: '#666', marginBottom: '30px', fontSize: '15px' }}>Windows 端已上线，立即下载即可体验完整功能。</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <a href="https://pan.577622.xyz/down.php/e5e679862e3fa78d2672e294c7c0642e.exe" target="_blank" rel="noreferrer" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', minWidth: 'unset' }}>下载 Windows 端（已上线）</a>
                                <button onClick={restartDemo} className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', border: '1px solid #d2d2d7', color: '#1d1d1f', minWidth: 'unset' }}>重新体验</button>
                                <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '13px', color: '#86868b', cursor: 'pointer', marginTop: '8px' }}>退出演示</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <button className="close-btn" onClick={onClose} title="退出体验" style={{ zIndex: 20001 }}><Icons.Close /></button>
        </div>
    );
};

const extraSlides = [
    ['Excel 批量导入', '学号、姓名、成绩字段自动识别并清洗。'],
    ['一键随机排座', '保留约束条件下快速生成备用方案。'],
    ['男女混排策略', '按比例交错分布，保持课堂互动平衡。'],
    ['分数梯度展示', '高分与低分区块可视化，快速排查失衡。'],
    ['禁用座位标记', '对损坏桌椅或临时空位进行锁定。'],
    ['同桌互助规则', '自动匹配强弱搭配，提升协作学习。'],
    ['小组色彩标识', '每组颜色独立，投屏时一眼识别。'],
    ['布局快照保存', '每次调整都可存档，便于回溯。'],
    ['快照恢复比对', '旧版与新版布局可快速切换对照。'],
    ['导出图片', '导出高清座位图，方便打印张贴。'],
    ['导出 JSON', '布局与约束一起备份，方便迁移。'],
    ['导入 JSON', '历史班级方案可直接复用。'],
    ['规则启停开关', '每条约束支持单独启停测试。'],
    ['冲突定位提示', '自动提示冲突学生与冲突原因。'],
    ['多版本方案管理', '一个班级保留多套排座方案。']
];

const extraVisual = (i) => {
    const type = i % 16;
    if (type === 0) {
        return (
            <div className="fx fx-bars">
                {[24, 38, 52, 66, 45, 58].map((h, idx) => <span key={idx} style={{ '--h': `${h}px` }}></span>)}
            </div>
        );
    }
    if (type === 1) {
        return <div className="fx fx-flip">{[...Array(6)].map((_, idx) => <span key={idx}></span>)}</div>;
    }
    if (type === 2) {
        return (
            <div className="fx fx-orbit">
                <div className="core"></div>
                {[...Array(4)].map((_, idx) => <span key={idx}></span>)}
            </div>
        );
    }
    if (type === 3) {
        return <div className="fx fx-scan"><div className="scanline"></div></div>;
    }
    if (type === 4) {
        return (
            <div className="fx fx-ring">
                <svg viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="40"></circle>
                    <circle className="progress" cx="60" cy="60" r="40"></circle>
                </svg>
            </div>
        );
    }
    if (type === 5) {
        return <div className="fx fx-steps">{[...Array(5)].map((_, idx) => <span key={idx}></span>)}</div>;
    }
    if (type === 6) {
        return <div className="fx fx-wave">{[...Array(8)].map((_, idx) => <span key={idx}></span>)}</div>;
    }
    if (type === 7) {
        return (
            <div className="fx fx-swap">
                <span className="a"></span>
                <span className="b"></span>
            </div>
        );
    }
    if (type === 8) {
        return (
            <div className="fx fx-radar">
                <span></span><span></span><span></span>
                <div className="sweep"></div>
            </div>
        );
    }
    if (type === 9) {
        return <div className="fx fx-matrix">{[...Array(16)].map((_, idx) => <span key={idx}></span>)}</div>;
    }
    if (type === 10) {
        return (
            <div className="fx fx-timeline">
                <div className="line"></div>
                {[...Array(4)].map((_, idx) => <span key={idx}></span>)}
            </div>
        );
    }
    if (type === 11) {
        return <div className="fx fx-hist">{[30, 58, 44, 70, 52].map((h, idx) => <span key={idx} style={{ '--h': `${h}px` }}></span>)}</div>;
    }
    if (type === 12) {
        return (
            <div className="fx fx-track">
                <div className="rail"></div>
                <div className="dot"></div>
            </div>
        );
    }
    if (type === 13) {
        return (
            <div className="fx fx-merge">
                <span className="left"></span>
                <span className="center"></span>
                <span className="right"></span>
            </div>
        );
    }
    if (type === 14) {
        return <div className="fx fx-switch">{[...Array(3)].map((_, idx) => <span key={idx}></span>)}</div>;
    }
    return (
        <div className="fx fx-paper">
            <div className="slot"></div>
            <div className="paper"></div>
        </div>
    );
};

function App() {
    const [immersive, setImmersive] = useState(false);
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('.reveal-section').forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, []);

    const showToast = (title, message) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, title, message }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
    };

    const enterImmersive = () => {
        if (window.innerWidth < 768) {
            showToast('设备不支持', '沉浸式排座体验需要更大的屏幕空间，请使用电脑访问。');
            return;
        }
        setImmersive(true);
        document.body.style.overflow = 'hidden';
    };

    const exitImmersive = () => { setImmersive(false); document.body.style.overflow = ''; };

    return (
        <div className="app">
            {immersive && <InteractiveDemo onClose={exitImmersive} />}
            <div className="toast-container">
                {toasts.map(toast => (
                    <div key={toast.id} className="toast">
                        <div className="toast-icon"><Icons.ToastInfo /></div>
                        <div className="toast-content"><div className="toast-title">{toast.title}</div><div className="toast-message">{toast.message}</div></div>
                    </div>
                ))}
            </div>

            <header className="site-header" style={{ opacity: immersive ? 0 : 1, transition: 'opacity 0.3s' }}>
                <div className="header-content">
                    <a href="#" className="logo"><Icons.Logo /><span>不想排座位</span></a>
                    <nav className="nav-links">
                        <a href="#features" className="nav-link">功能特性</a>
                        <a href="https://github.com/laosan577622/open_fuckseats" className="nav-link" target="_blank" rel="noreferrer">开源代码</a>
                        <a href="https://pan.577622.xyz/down.php/e5e679862e3fa78d2672e294c7c0642e.exe" className="nav-button" target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', fontWeight: 500, fontSize: '12px', textDecoration: 'none' }}>Windows 已上线</a>
                    </nav>
                </div>
            </header>

            <main>
                <section className="hero" style={{ minHeight: '80vh', justifyContent: 'center' }}>
                    <div className="container reveal-section">
                        <span className="hero-tag">班级管理新体验</span>
                        <h1 className="hero-title">告别繁琐，<br />让排座变得简单优雅。</h1>
                        <p className="hero-subtitle">专为班主任打造的智能排座系统。Windows 端已上线，支持成绩分析、互斥规则、小组管理，一键导出精美座位表。</p>
                        <div className="cta-group">
                            <a href="https://pan.577622.xyz/down.php/e5e679862e3fa78d2672e294c7c0642e.exe" className="btn btn-primary" target="_blank" rel="noreferrer">下载 Windows 端</a>
                            <a href="https://github.com/laosan577622/open_fuckseats" className="btn btn-outline" target="_blank" rel="noreferrer">查看 GitHub</a>
                        </div>
                        <div style={{ marginTop: 60, opacity: 0.5, animation: 'bounce 2s infinite' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 13l5 5 5-5M7 6l5 5 5-5" /></svg>
                        </div>
                    </div>
                </section>

                <section id="features" style={{ padding: '0 0 100px' }}>
                    <div className="container">
                        <div className="reveal-section feature-slide">
                            <div className="slide-content">
                                <h2 className="slide-title">智能 S 型排座</h2>
                                <p className="slide-desc">无需人工干预，只需导入成绩，系统即可瞬间生成科学合理的座位表。S 型排列确保每个位置都公平公正，彻底告别谁坐哪里的烦恼。</p>
                            </div>
                            <div className="slide-visual">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, opacity: 0.8 }}>
                                    {[...Array(16)].map((_, i) => <div key={i} className="anim-grid" style={{ width: 40, height: 30, background: i % 2 === 0 ? '#e1f5fe' : '#f5f5f7', borderRadius: 4 }}></div>)}
                                </div>
                            </div>
                        </div>

                        <div className="reveal-section feature-slide reverse">
                            <div className="slide-content">
                                <h2 className="slide-title">科学分组与师徒结对</h2>
                                <p className="slide-desc">独创师徒互助算法，自动将学优生与待提升学生配对，同时平衡各组平均分，让班级形成稳定的互助学习网络。</p>
                            </div>
                            <div className="slide-visual">
                                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                        <div className="anim-score-ball" style={{ width: 50, height: 50, background: '#FF5F56', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>98</div>
                                        <div className="anim-link" style={{ width: 2, height: 40, background: '#ddd' }}></div>
                                        <div className="anim-score-ball" style={{ width: 50, height: 50, background: '#FF5F56', borderRadius: '50%', opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: 12 }}>62</div>
                                    </div>
                                    <div style={{ fontSize: 24, color: '#ccc' }}>+</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                        <div className="anim-score-ball" style={{ width: 50, height: 50, background: '#007AFF', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>95</div>
                                        <div className="anim-link" style={{ width: 2, height: 40, background: '#ddd' }}></div>
                                        <div className="anim-score-ball" style={{ width: 50, height: 50, background: '#007AFF', borderRadius: '50%', opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: 12 }}>65</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="reveal-section feature-slide">
                            <div className="slide-content">
                                <h2 className="slide-title">灵活的规则约束</h2>
                                <p className="slide-desc">支持禁止同桌、必须相邻及固定区域等多种规则，满足班主任在不同场景下的精细化座位管理需求。</p>
                            </div>
                            <div className="slide-visual">
                                <div style={{ position: 'relative', width: 220, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div className="anim-repel-l" style={{ width: 60, height: 60, background: '#f5f5f7', borderRadius: 12, border: '2px dashed #ff3b30', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff3b30', fontWeight: 'bold' }}>A</div>
                                    <div style={{ margin: '0 20px', fontSize: 24, color: '#ff3b30', fontWeight: 'bold' }}>≠</div>
                                    <div className="anim-repel-r" style={{ width: 60, height: 60, background: '#f5f5f7', borderRadius: 12, border: '2px dashed #ff3b30', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff3b30', fontWeight: 'bold' }}>B</div>
                                </div>
                            </div>
                        </div>

                        {extraSlides.map((item, i) => (
                            <div key={item[0]} className={`reveal-section feature-slide ${i % 2 ? 'reverse' : ''}`}>
                                <div className="slide-content">
                                    <h2 className="slide-title">{item[0]}</h2>
                                    <p className="slide-desc">{item[1]}</p>
                                </div>
                                <div className="slide-visual">{extraVisual(i)}</div>
                            </div>
                        ))}

                        <div className="reveal-section feature-slide" style={{ flexDirection: 'column', textAlign: 'center', marginTop: 100 }}>
                            <div className="slide-content" style={{ maxWidth: 700 }}>
                                <h2 className="slide-title">亲身体验，一触即发</h2>
                                <p className="slide-desc" style={{ marginBottom: 40 }}>不要只是听我们说，现在就在浏览器中模拟真实教室排座流程。请使用电脑访问以获得完整体验。</p>
                            </div>
                            <div className="browser-mockup" style={{ cursor: 'pointer', width: '100%', maxWidth: 800 }} onClick={enterImmersive}>
                                <div className="browser-header">
                                    <span className="dot dot-red"></span><span className="dot dot-yellow"></span><span className="dot dot-green"></span>
                                </div>
                                <div style={{ height: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa', position: 'relative', overflow: 'hidden' }}>
                                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.1, background: 'repeating-linear-gradient(45deg, #0a59f7 0, #0a59f7 1px, transparent 0, transparent 50%)', backgroundSize: '10px 10px' }}></div>
                                    <div className="anim-pulse" style={{ width: 80, height: 80, borderRadius: '50%', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', zIndex: 2, transition: 'transform 0.3s' }}>
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0a59f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                    </div>
                                    <div style={{ marginTop: 20, color: '#0a59f7', fontWeight: 600, fontSize: '18px', zIndex: 2 }}>进入沉浸式体验</div>
                                    <span style={{ fontSize: '14px', color: '#888', marginTop: 6, zIndex: 2 }}>全屏模拟排座流程</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="site-footer">
                <div className="container footer-content">
                    <span>© 2026 不想排座位</span>
                    <span>开发者：老三 · <a href="https://www.577622.xyz" target="_blank" rel="noreferrer" style={{ color: '#0a59f7', textDecoration: 'none' }}>www.577622.xyz</a></span>
                </div>
            </footer>
        </div>
    );
}

export default App;
