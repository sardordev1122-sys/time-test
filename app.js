let data = {
    teachers: [],
    tests: [],
    results: [],
    subjects: []
};

let lastDataString = "";

async function loadDataFromBackend() {
    try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok) {
            const serverData = await res.json();
            
            let defaultSubjects = [
                "Ingliz tili", "Rus tili", "Kores tili", "Arab tili", "Kimyo", "Biologiya",
                "Matematika", "Ona tili", "Fizika", "Tarix", "Geografiya", "Informatika", "Adabiyot"
            ];
            
            let newSubjects;
            if (serverData.subjects && serverData.subjects.length > 0) {
                newSubjects = Array.from(new Set([...defaultSubjects, ...serverData.subjects]));
            } else {
                newSubjects = defaultSubjects;
            }
            
            const newData = {
                teachers: serverData.teachers || [],
                tests: serverData.tests || [],
                results: (serverData.results || []).map((r, i) => {
                    if (!r.id) r.id = 'legacy_' + i + '_' + Date.now().toString();
                    return r;
                }),
                subjects: newSubjects
            };
            
            const newDataString = JSON.stringify(newData);
            if (newDataString !== lastDataString) {
                data = newData;
                lastDataString = newDataString;
                
                // Only update UI if something actually changed
                if (typeof updateDashboardStats === 'function') updateDashboardStats();
                if (typeof renderTeachersTable === 'function') renderTeachersTable();
                if (typeof renderTestsTable === 'function') renderTestsTable();
                if (typeof renderResultsTable === 'function') renderResultsTable();
                
                // Only update admin selects if no modal is currently open (prevents resetting user input)
                const isAnyModalActive = document.querySelector('.modal.active');
                if (!isAnyModalActive && typeof populateTeacherSelectsAdmin === 'function') {
                    populateTeacherSelectsAdmin();
                }
                
                // Update student selects if they are in the registration view
                if (!currentStudent && typeof populateTeachersForStudent === 'function') {
                    populateTeachersForStudent();
                }
            }
        }
    } catch(e) {
        console.error("Backenddan ma'lumot olishda xatolik:", e);
    }
}

async function saveData() {
    try {
        await fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch(e) {
        console.error("Backendga saqlashda xatolik:", e);
    }
}

const GEMINI_API_KEY = "AQ.Ab8RN6I5oz_B93pqLpvtmW7fQSwtkWvV6WN1BJEDP0YTBxI2Ug";

const LEVELS = {
    "Ingliz tili": [
        "Month 1: Beginner (A0-A1)",
        "Month 2: Beginner (A0-A1)",
        "Month 3: Elementary (A1+-A2)",
        "Month 4: Elementary (A1+-A2)",
        "Month 5: Pre-Intermediate (A2+-B1)",
        "Month 6: Pre-Intermediate (A2+-B1)",
        "Month 7: Intermediate (B1)",
        "Month 8: Intermediate (B1)"
    ],
    "default": [
        "Boshlang'ich",
        "O'rta",
        "Murakkab"
    ]
};

function getLevelsForSubject(subject) {
    if (!subject) return LEVELS["default"];
    const lowerSub = subject.toLowerCase();
    if (lowerSub.includes("ingliz") || lowerSub.includes("ingilz") || lowerSub.includes("english")) {
        return LEVELS["Ingliz tili"];
    }
    return LEVELS["default"];
}

// End of old saveData (removed)

// Current Test Session
let currentStudent = null;
let currentTest = null;
let userAnswers = [];
let testTimer = null;
let testTimeRemaining = 3600; // default
let isAutoSubmit = false;

// Roles
let currentLoggedInTeacherId = null;

// Modals
function openModal(id) {
    document.getElementById(id).classList.add('active');
    if (id === 'add-test-modal') {
        populateTeacherSelectsAdmin();
    }
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function closeAdminLogin() {
    closeModal('admin-login-modal');
}

document.addEventListener('DOMContentLoaded', () => {
    loadDataFromBackend();
    setInterval(loadDataFromBackend, 5000); // Polling every 5 seconds
    
    // Mode Selection
    document.getElementById('btn-student-mode').addEventListener('click', () => {
        document.getElementById('mode-selector').classList.add('hidden');
        document.getElementById('student-app').classList.remove('hidden');
        populateTeachersForStudent();
    });

    document.getElementById('btn-admin-login-mode').addEventListener('click', () => {
        openModal('admin-login-modal');
    });
    
    document.getElementById('btn-teacher-login-mode').addEventListener('click', () => {
        openModal('teacher-login-modal');
    });
    
    document.getElementById('teacher-login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const user = document.getElementById('teacher-username').value;
        const pass = document.getElementById('teacher-password').value;
        
        const teacher = data.teachers.find(t => t.login === user && t.password === pass);
        
        if (teacher) {
            currentLoggedInTeacherId = teacher.id;
            closeModal('teacher-login-modal');
            document.getElementById('mode-selector').classList.add('hidden');
            document.getElementById('admin-app').classList.remove('hidden');
            e.target.reset();
            initAdminPanel();
        } else {
            alert('Login yoki parol noto\'g\'ri!');
        }
    });
    
    document.getElementById('admin-login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const user = document.getElementById('admin-username').value;
        const pass = document.getElementById('admin-password').value;
        
        if (user === '452' && pass === '187') {
            currentLoggedInTeacherId = null; // Admin
            closeModal('admin-login-modal');
            document.getElementById('mode-selector').classList.add('hidden');
            document.getElementById('admin-app').classList.remove('hidden');
            e.target.reset();
            initAdminPanel();
        } else {
            alert('Login yoki parol noto\'g\'ri!');
        }
    });

    // ================= STUDENT LOGIC =================
    document.getElementById('student-form').addEventListener('submit', handleStartTest);
    document.getElementById('test-form').addEventListener('submit', handleFinishTest);
    
    document.getElementById('teacherSelect').addEventListener('change', function() {
        const teacherId = this.value;
        const subjectInput = document.getElementById('studentSubjectSelect');
        const levelSelect = document.getElementById('levelSelect');
        
        subjectInput.value = '';
        levelSelect.innerHTML = '<option value="">Oldin fanni tanlang</option>';
        levelSelect.disabled = true;
        
        if (teacherId) {
            const teacher = data.teachers.find(t => t.id == teacherId);
            if (teacher && teacher.subjects && teacher.subjects.length > 0) {
                const subject = teacher.subjects[0];
                subjectInput.value = subject;
                
                levelSelect.innerHTML = '<option value="">Tanlang...</option>';
                const levels = getLevelsForSubject(subject);
                let hasAnyTest = false;
                
                levels.forEach(lvl => {
                    const hasTest = data.tests.some(t => t.teacherId == teacherId && t.subject === subject && t.level === lvl);
                    const option = document.createElement('option');
                    option.value = lvl;
                    if (hasTest) {
                        option.textContent = lvl;
                        hasAnyTest = true;
                    } else {
                        option.textContent = `${lvl} (Test yaratilmagan)`;
                        option.disabled = true;
                    }
                    levelSelect.appendChild(option);
                });
                levelSelect.disabled = false;
                
                if (!hasAnyTest) {
                    alert(`Kechirasiz, ushbu o'qituvchi tomonidan ${subject} fanidan hali hech qanday test yaratilmagan!`);
                }
            }
        } else {
            subjectInput.value = '';
        }
    });
    
    // Close modal if clicked outside
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.classList.remove('active');
        }
        
        // Close custom dropdown if clicked outside
        if (!event.target.closest('#custom-subjects-wrapper')) {
            const options = document.getElementById('t-subjects-options');
            if (options) options.classList.remove('active');
        }
    }
});

function populateTeachersForStudent() {
    const select = document.getElementById('teacherSelect');
    if(!select) return;
    
    select.innerHTML = '<option value="">Tanlang...</option>';
    data.teachers.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = `${t.firstName} ${t.lastName}`;
        select.appendChild(option);
    });
}

function handleStartTest(e) {
    e.preventDefault();
    
    const firstName = document.getElementById('firstName').value;
    const lastName = document.getElementById('lastName').value;
    const phone = document.getElementById('phone').value;
    const teacherId = document.getElementById('teacherSelect').value;
    const subject = document.getElementById('studentSubjectSelect').value;
    const level = document.getElementById('levelSelect').value;
    
    // Check if tests exist
    const matchingTests = data.tests.filter(t => t.teacherId === teacherId && t.subject === subject && t.level === level);
    
    if (matchingTests.length === 0) {
        alert(`Kechirasiz, ushbu o'qituvchi tomonidan ${subject} fanidan ${level} daraja uchun hozircha test yaratilmagan!`);
        return;
    }
    
    // Pick a random test variant to prevent cheating if there are multiple variants
    currentTest = matchingTests[Math.floor(Math.random() * matchingTests.length)];
    
    currentStudent = {
        firstName,
        lastName,
        phone,
        teacherId,
        subject,
        level,
        date: new Date().toISOString()
    };
    
    document.getElementById('registration-card').classList.add('hidden');
    document.getElementById('test-card').classList.remove('hidden');
    
    const teacher = data.teachers.find(t => t.id === teacherId);
    document.getElementById('test-info-display').textContent = `${teacher.firstName} ${teacher.lastName} - ${subject} (${level})`;
    
    renderTestQuestions();
    const durationMins = currentTest.duration || 60;
    startTestTimer(durationMins * 60);
}

function startTestTimer(duration) {
    testTimeRemaining = duration;
    updateTimerDisplay();
    clearInterval(testTimer);
    testTimer = setInterval(() => {
        testTimeRemaining--;
        updateTimerDisplay();
        if (testTimeRemaining <= 0) {
            clearInterval(testTimer);
            alert("Vaqt tugadi! Test avtomatik tarzda yakunlandi.");
            isAutoSubmit = true;
            const submitBtn = document.getElementById('submit-test-btn');
            if (submitBtn) submitBtn.click();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(testTimeRemaining / 60);
    const seconds = testTimeRemaining % 60;
    document.getElementById('test-timer').textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Shuffle array utility
function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

function renderTestQuestions() {
    const container = document.getElementById('questions-container');
    container.innerHTML = '';
    
    // Shuffle questions as well if desired, but user just asked to shuffle options.
    const questionsToRender = currentTest.questions.slice(0, 50);
    
    questionsToRender.forEach((q, index) => {
        const block = document.createElement('div');
        block.className = 'question-block';
        block.id = `qb-${index}`;
        block.style.display = index === 0 ? 'block' : 'none';
        
        // Shuffle options and remember the new correct index or map it
        // We will store the original options text and use that for mapping, or just map indices.
        // It's safer to store the original correct option text string.
        let originalCorrectText = q.options[q.correctAnswerIndex];
        
        let shuffledOptions = [...q.options];
        shuffleArray(shuffledOptions);
        
        // Find the new correct answer index in the shuffled array
        let newCorrectIndex = shuffledOptions.indexOf(originalCorrectText);
        
        // Store it so we can check it later without modifying the original question object in state
        q.shuffledOptions = shuffledOptions;
        q.shuffledCorrectIndex = newCorrectIndex;

        let optionsHTML = '';
        shuffledOptions.forEach((opt, optIndex) => {
            optionsHTML += `
                <label class="option-label">
                    <input type="radio" name="q${index}" value="${optIndex}" onchange="goToNextQuestion(${index}, ${questionsToRender.length})" required>
                    ${opt}
                </label>
            `;
        });
        
        block.innerHTML = `
            <div class="question-text">${index + 1} / ${questionsToRender.length}. ${q.question}</div>
            <div class="options">
                ${optionsHTML}
            </div>
        `;
        
        container.appendChild(block);
    });
    
    const submitBtn = document.getElementById('submit-test-btn');
    if (submitBtn) submitBtn.style.display = 'none';
}

function goToNextQuestion(currentIndex, totalQuestions) {
    setTimeout(() => {
        const currentBlock = document.getElementById(`qb-${currentIndex}`);
        if (currentBlock) currentBlock.style.display = 'none';
        
        const nextIndex = currentIndex + 1;
        if (nextIndex < totalQuestions) {
            const nextBlock = document.getElementById(`qb-${nextIndex}`);
            if (nextBlock) nextBlock.style.display = 'block';
        } else {
            isAutoSubmit = true;
            const submitBtn = document.getElementById('submit-test-btn');
            if (submitBtn) submitBtn.click();
        }
    }, 300);
}

function handleFinishTest(e) {
    e.preventDefault();
    
    if (!isAutoSubmit) {
        if(!confirm("Testni rostdan ham yakunlamoqchimisiz?")) return;
    }
    isAutoSubmit = false;
    
    clearInterval(testTimer);
    
    const formData = new FormData(e.target);
    let correctCount = 0;
    let wrongCount = 0;
    
    const questionsToRender = currentTest.questions.slice(0, 50);
    const totalQuestions = questionsToRender.length;
    
    questionsToRender.forEach((q, index) => {
        const selectedOption = formData.get(`q${index}`);
        if (selectedOption !== null && parseInt(selectedOption) === q.shuffledCorrectIndex) {
            correctCount++;
        } else {
            wrongCount++;
        }
    });
    
    const resultObj = {
        id: Date.now().toString(),
        ...currentStudent,
        correct: correctCount,
        wrong: wrongCount,
        total: totalQuestions
    };
    
    data.results.push(resultObj);
    saveData();
    
    document.getElementById('test-card').classList.add('hidden');
    document.getElementById('result-card').classList.remove('hidden');
    
    // Circular Chart Animation
    const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const chart = document.getElementById('res-chart');
    const percentText = document.getElementById('res-percentage');
    
    let currentPercent = 0;
    chart.style.background = `conic-gradient(var(--success) 0%, var(--border-color) 0%)`;
    
    if (percentage > 0) {
        const interval = setInterval(() => {
            currentPercent++;
            chart.style.background = `conic-gradient(var(--success) ${currentPercent}%, var(--border-color) ${currentPercent}%)`;
            percentText.textContent = `${currentPercent}%`;
            
            if (currentPercent >= percentage) {
                clearInterval(interval);
            }
        }, 15);
    } else {
        percentText.textContent = `0%`;
    }
    
    animateValue("res-total", 0, totalQuestions, 1000);
    animateValue("res-correct", 0, correctCount, 1500);
    animateValue("res-wrong", 0, wrongCount, 1500);
}

function animateValue(id, start, end, duration) {
    if (start === end) {
        document.getElementById(id).innerHTML = end;
        return;
    }
    var range = end - start;
    var current = start;
    var increment = end > start ? 1 : -1;
    var stepTime = Math.abs(Math.floor(duration / range));
    var obj = document.getElementById(id);
    var timer = setInterval(function() {
        current += increment;
        obj.innerHTML = current;
        if (current == end) {
            clearInterval(timer);
        }
    }, stepTime);
}

// ================= ADMIN LOGIC =================
function initAdminPanel() {
    updateDashboardStats();
    renderTeachersTable();
    renderSubjectsTable();
    renderTestsTable();
    renderResultsTable();
    populateTeacherSelectsAdmin();
    
    // Teacher Mode Restrictions
    if (currentLoggedInTeacherId) {
        document.querySelector('.nav-link[data-target="teachers"]').parentElement.style.display = 'none';
        document.querySelector('.nav-link[data-target="subjects"]').parentElement.style.display = 'none';
        
        // Hide global export buttons if they exist
        const globalPdfBtn = document.getElementById('btn-export-pdf');
        if (globalPdfBtn) globalPdfBtn.style.display = 'inline-block';
    } else {
        document.querySelector('.nav-link[data-target="teachers"]').parentElement.style.display = 'block';
        document.querySelector('.nav-link[data-target="subjects"]').parentElement.style.display = 'block';
    }
    
    // Sidebar Navigation
    const navLinks = document.querySelectorAll('.nav-link[data-target]');
    const sections = document.querySelectorAll('.content-section');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            const target = link.getAttribute('data-target');
            sections.forEach(sec => {
                if (sec.id === target) {
                    sec.classList.remove('hidden');
                } else {
                    sec.classList.add('hidden');
                }
            });
        });
    });

    // Form Submissions
    document.getElementById('add-teacher-form').addEventListener('submit', handleAddTeacher);
    document.getElementById('add-subject-form').addEventListener('submit', handleAddSubject);
    document.getElementById('manual-test-form').addEventListener('submit', handleSaveManualTest);
    document.getElementById('btn-parse-text').addEventListener('click', parseRawTestText);
    document.getElementById('btn-add-question').addEventListener('click', () => addManualQuestionUI());
    
    // Select Change Event
    document.getElementById('gen-teacher').addEventListener('change', function() {
        const teacherId = this.value;
        const subjectSelect = document.getElementById('gen-subject');
        const levelSelect = document.getElementById('gen-level');
        
        subjectSelect.innerHTML = '<option value="">Tanlang...</option>';
        levelSelect.innerHTML = '<option value="">Oldin fanni tanlang</option>';
        
        if (teacherId) {
            const teacher = data.teachers.find(t => t.id == teacherId);
            if (teacher) {
                teacher.subjects.forEach(sub => {
                    const option = document.createElement('option');
                    option.value = sub;
                    option.textContent = sub;
                    subjectSelect.appendChild(option);
                });
                
                if (teacher.subjects.length === 1) {
                    subjectSelect.value = teacher.subjects[0];
                    subjectSelect.dispatchEvent(new Event('change'));
                }
            }
        }
    });

    document.getElementById('gen-subject').addEventListener('change', function() {
        const subject = this.value;
        const levelSelect = document.getElementById('gen-level');
        
        levelSelect.innerHTML = '<option value="">Tanlang...</option>';
        
        if (subject) {
            const levels = getLevelsForSubject(subject);
            levels.forEach(lvl => {
                const option = document.createElement('option');
                option.value = lvl;
                option.textContent = lvl;
                levelSelect.appendChild(option);
            });
            levelSelect.disabled = false;
        } else {
            levelSelect.innerHTML = '<option value="">Oldin fanni tanlang</option>';
            levelSelect.disabled = true;
        }
    });

    // Exports
    document.getElementById('btn-export-excel').addEventListener('click', exportTeacherStudentsToExcel);
    document.getElementById('btn-export-pdf-teacher').addEventListener('click', exportTeacherStudentsToPDF);
    document.getElementById('btn-export-pdf').addEventListener('click', exportResultsToPDF);
    document.getElementById('results-teacher-filter').addEventListener('change', function() {
        updateResultsLevelFilter();
        renderResultsTable();
    });
}

function updateDashboardStats() {
    let statsResults = data.results;
    let statsTests = data.tests;
    let statsTeachers = data.teachers.length;
    
    if (currentLoggedInTeacherId) {
        statsResults = data.results.filter(r => r.teacherId === currentLoggedInTeacherId);
        statsTests = data.tests.filter(t => t.teacherId === currentLoggedInTeacherId);
        statsTeachers = 1;
    }
    
    const uniqueStudents = new Set(statsResults.map(r => r.phone)).size;
    document.getElementById('stat-total-students').textContent = uniqueStudents;
    document.getElementById('stat-total-tests').textContent = statsTests.length;
    document.getElementById('stat-total-teachers').textContent = statsTeachers;
    
    // Render recent results
    const recentTbody = document.querySelector('#recent-results-table tbody');
    if (recentTbody) {
        recentTbody.innerHTML = '';
        const recentResults = [...statsResults].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        recentResults.forEach(res => {
            const teacher = data.teachers.find(t => t.id === res.teacherId);
            const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName}` : "Noma'lum";
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${res.firstName} ${res.lastName}</td>
                <td>${teacherName}</td>
                <td>${res.level}</td>
                <td><strong style="color:var(--success)">${res.correct}/${res.total}</strong></td>
                <td>${new Date(res.date).toLocaleDateString('uz-UZ')}</td>
            `;
            recentTbody.appendChild(tr);
        });
        if(recentResults.length === 0) {
            recentTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 3rem;"><i class="ph ph-folder-open" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem; display: block;"></i><p style="color: var(--text-light); font-size: 1.1rem;">Hozircha natijalar yo\'q</p></td></tr>';
        }
    }
}

function handleAddTeacher(e) {
    e.preventDefault();
    const firstName = document.getElementById('t-firstName').value;
    const lastName = document.getElementById('t-lastName').value;
    const phone = document.getElementById('t-phone').value;
    
    // Get selected subject
    const selectedValue = document.getElementById('custom-select-chips').getAttribute('data-selected-value');
    
    if (!selectedValue) {
        alert("Iltimos, fanni tanlang!");
        return;
    }
    
    const subjects = [selectedValue];
    const login = Math.floor(100 + Math.random() * 900).toString();
    const password = Math.floor(100 + Math.random() * 900).toString();
    
    const newTeacher = {
        id: Date.now().toString(),
        firstName,
        lastName,
        phone,
        subjects,
        login,
        password
    };
    
    data.teachers.push(newTeacher);
    saveData();
    updateDashboardStats();
    renderTeachersTable();
    populateTeacherSelectsAdmin();
    e.target.reset();
    closeModal('add-teacher-modal');
}

function renderTeachersTable() {
    const tbody = document.querySelector('#teachers-table tbody');
    tbody.innerHTML = '';
    
    if (data.teachers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 3rem;"><i class="ph ph-users-slash" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem; display: block;"></i><p style="color: var(--text-light); font-size: 1.1rem;">Hozircha o\'qituvchilar yo\'q</p></td></tr>';
        return;
    }
    
    data.teachers.forEach(teacher => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${teacher.firstName} ${teacher.lastName}</td>
            <td>${teacher.phone}</td>
            <td>${teacher.subjects.join(', ')}</td>
            <td><strong style="color:var(--success)">L:</strong> ${teacher.login || '-'} <strong style="color:var(--danger); margin-left:5px;">P:</strong> ${teacher.password || '-'}</td>
            <td>
                <button class="btn" style="padding: 5px 10px; font-size: 0.8rem;" onclick="viewTeacherStudents('${teacher.id}')">O'quvchilar</button>
                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem; margin-left: 5px;" onclick="deleteTeacher('${teacher.id}')">O'chirish</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteTeacher(id) {
    data.teachers = data.teachers.filter(t => t.id !== id);
    saveData();
    renderTeachersTable();
    populateTeacherSelectsAdmin();
    updateDashboardStats();
}

function handleAddSubject(e) {
    e.preventDefault();
    const name = document.getElementById('s-name').value.trim();
    if (!name) return;
    
    if (data.subjects.includes(name)) {
        alert("Bu fan allaqachon mavjud!");
        return;
    }
    
    data.subjects.push(name);
    saveData();
    renderSubjectsTable();
    populateTeacherSelectsAdmin();
    e.target.reset();
    closeModal('add-subject-modal');
}

function renderSubjectsTable() {
    const tbody = document.querySelector('#subjects-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (data.subjects.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding: 3rem;"><i class="ph ph-books" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem; display: block;"></i><p style="color: var(--text-light); font-size: 1.1rem;">Hozircha fanlar yo\'q</p></td></tr>';
        return;
    }
    
    data.subjects.forEach(subject => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${subject}</td>
            <td>
                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="deleteSubject('${subject}')">O'chirish</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteSubject(subject) {
    data.subjects = data.subjects.filter(s => s !== subject);
    saveData();
    renderSubjectsTable();
    populateTeacherSelectsAdmin();
}

// Store manual questions count
let manualQuestionCount = 0;

function addManualQuestionUI(qText = '', optA = '', optB = '', optC = '', optD = '', correctIndex = -1) {
    manualQuestionCount++;
    const container = document.getElementById('manual-questions-container');
    const qDiv = document.createElement('div');
    qDiv.className = 'card manual-q-card';
    qDiv.style.marginBottom = '1rem';
    qDiv.style.padding = '1rem';
    qDiv.style.border = '1px solid var(--border-color)';
    qDiv.dataset.id = manualQuestionCount;
    
    qDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem;">
            <strong>Savol ${manualQuestionCount}</strong>
            <button type="button" class="btn btn-danger" style="padding: 2px 8px; font-size: 0.8rem;" onclick="this.parentElement.parentElement.remove()">X</button>
        </div>
        <div class="form-group">
            <textarea class="form-control q-text" rows="2" placeholder="Savol matni..." required>${qText}</textarea>
        </div>
        <div class="form-row" style="margin-bottom: 0.5rem;">
            <div class="form-group" style="flex:1; display:flex; align-items:flex-start; gap: 5px; cursor: pointer;" onclick="this.querySelector('input[type=\\'radio\\']').checked = true;">
                <input type="radio" name="q_correct_${manualQuestionCount}" value="0" style="margin-top: 12px;" required title="To'g'ri javob" ${correctIndex === 0 ? 'checked' : ''}>
                <textarea class="form-control q-opt" rows="2" placeholder="A varianti" required>${optA}</textarea>
            </div>
            <div class="form-group" style="flex:1; display:flex; align-items:flex-start; gap: 5px; cursor: pointer;" onclick="this.querySelector('input[type=\\'radio\\']').checked = true;">
                <input type="radio" name="q_correct_${manualQuestionCount}" value="1" style="margin-top: 12px;" required title="To'g'ri javob" ${correctIndex === 1 ? 'checked' : ''}>
                <textarea class="form-control q-opt" rows="2" placeholder="B varianti" required>${optB}</textarea>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group" style="flex:1; display:flex; align-items:flex-start; gap: 5px; cursor: pointer;" onclick="this.querySelector('input[type=\\'radio\\']').checked = true;">
                <input type="radio" name="q_correct_${manualQuestionCount}" value="2" style="margin-top: 12px;" required title="To'g'ri javob" ${correctIndex === 2 ? 'checked' : ''}>
                <textarea class="form-control q-opt" rows="2" placeholder="C varianti" required>${optC}</textarea>
            </div>
            <div class="form-group" style="flex:1; display:flex; align-items:flex-start; gap: 5px; cursor: pointer;" onclick="this.querySelector('input[type=\\'radio\\']').checked = true;">
                <input type="radio" name="q_correct_${manualQuestionCount}" value="3" style="margin-top: 12px;" required title="To'g'ri javob" ${correctIndex === 3 ? 'checked' : ''}>
                <textarea class="form-control q-opt" rows="2" placeholder="D varianti" required>${optD}</textarea>
            </div>
        </div>
    `;
    container.appendChild(qDiv);
}

function parseRawTestText() {
    const rawText = document.getElementById('raw-test-text').value;
    if (!rawText.trim()) {
        alert("Iltimos, matnni kiriting!");
        return;
    }
    
    // Remove markdown bold asterisks and hashes just in case
    const cleanText = rawText.replace(/[\*#]/g, '');
    
    // We split by lines, look for question numbers and options.
    const blocks = cleanText.split(/(?=(?:^|\n)\s*\d+[\.\)]\s+)/);
    
    let parsedCount = 0;
    
    blocks.forEach(block => {
        if (!block.trim()) return;
        let qMatch = block.match(/^\s*\d+[\.\)]\s*(.*?)(?=(?:^|\n)\s*[Aa][\)\.])/s);
        let aMatch = block.match(/(?:^|\n)\s*[Aa][\)\.]\s*(.*?)(?=(?:^|\n)\s*[Bb][\)\.]|$)/s);
        let bMatch = block.match(/(?:^|\n)\s*[Bb][\)\.]\s*(.*?)(?=(?:^|\n)\s*[Cc][\)\.]|$)/s);
        let cMatch = block.match(/(?:^|\n)\s*[Cc][\)\.]\s*(.*?)(?=(?:^|\n)\s*[Dd][\)\.]|$)/s);
        let dMatch = block.match(/(?:^|\n)\s*[Dd][\)\.]\s*(.*?)(?=(?:^|\n)\s*\d+[\.\)]|$)/s);
        
        if (qMatch && aMatch && bMatch && cMatch && dMatch) {
            let dText = dMatch[1];
            let correctIndex = -1;
            
            // Extract answer if Javob: A) or Answer: B etc is present
            let ansMatch = block.match(/(?:javob|answer|ответ)[a-z]*\s*[:\-\.]?\s*([A-Da-d])\b/i);
            if (ansMatch) {
                const char = ansMatch[1].toUpperCase();
                correctIndex = ['A', 'B', 'C', 'D'].indexOf(char);
                
                // Clean up D option text
                let javobSearch = dText.search(/(?:^|\n)\s*(?:###\s*)?(?:javob|answer|ответ)/i);
                if (javobSearch !== -1) {
                    dText = dText.substring(0, javobSearch);
                }
            }

            addManualQuestionUI(
                qMatch[1].trim(), 
                aMatch[1].trim(), 
                bMatch[1].trim(), 
                cMatch[1].trim(), 
                dText.trim(),
                correctIndex
            );
            parsedCount++;
        }
    });
    
    if (parsedCount > 0) {
        document.getElementById('raw-test-text').value = ''; // clear
    } else {
        alert("Matndan savollarni ajratib bo'lmadi. Format noto'g'ri bo'lishi mumkin. '1. Savol... A) ... B) ... C) ... D) ...' formatida kiritganingizga ishonch hosil qiling.");
    }
}

// Reset questions when opening modal
const originalOpenModal = openModal;
openModal = function(id) {
    if (id === 'add-test-modal') {
        manualQuestionCount = 0;
        document.getElementById('manual-questions-container').innerHTML = '';
        document.getElementById('raw-test-text').value = '';

    }
    originalOpenModal(id);
};

function handleSaveManualTest(e) {
    e.preventDefault();
    
    const teacherId = document.getElementById('gen-teacher').value;
    const subject = document.getElementById('gen-subject').value;
    const level = document.getElementById('gen-level').value;
    const duration = parseInt(document.getElementById('gen-duration').value) || 60;
    
    if (!teacherId || !subject || !level) {
        alert("Iltimos, o'qituvchi, fan va darajani tanlang!");
        return;
    }
    
    const qCards = document.querySelectorAll('.manual-q-card');
    if (qCards.length === 0) {
        alert("Kamida bitta savol qo'shing!");
        return;
    }
    
    let questions = [];
    let isValid = true;
    
    qCards.forEach(card => {
        const text = card.querySelector('.q-text').value.trim();
        const opts = Array.from(card.querySelectorAll('.q-opt')).map(inp => inp.value.trim());
        const correctRadio = card.querySelector('input[type="radio"]:checked');
        
        if (!text || opts.some(o => !o) || !correctRadio) {
            isValid = false;
        } else {
            questions.push({
                question: text,
                options: opts,
                correctAnswerIndex: parseInt(correctRadio.value)
            });
        }
    });
    
    if (!isValid) {
        alert("Iltimos, hamma savollar matnini, variantlarini to'liq kiriting va to'g'ri javobni belgilang!");
        return;
    }

    const newTest = {
        id: Date.now().toString(),
        teacherId,
        subject,
        level,
        duration,
        questions,
        createdAt: new Date().toISOString()
    };
    
    data.tests.push(newTest);
    saveData();
    renderTestsTable();
    closeModal('add-test-modal');
    e.target.reset();
}

function renderTestsTable() {
    const tbody = document.querySelector('#tests-table tbody');
    tbody.innerHTML = '';
    
    let filteredTests = data.tests;
    if (currentLoggedInTeacherId) {
        filteredTests = filteredTests.filter(t => t.teacherId === currentLoggedInTeacherId);
    }
    
    if (filteredTests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 3rem;"><i class="ph ph-exam" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem; display: block;"></i><p style="color: var(--text-light); font-size: 1.1rem;">Hozircha testlar yo\'q</p></td></tr>';
        return;
    }
    
    filteredTests.forEach(test => {
        const teacher = data.teachers.find(t => t.id === test.teacherId);
        const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Noma\'lum';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${teacherName}</td>
            <td>${test.subject}</td>
            <td>${test.level}</td>
            <td>${test.questions.length} ta</td>
            <td>${test.duration || 60} daqiqa</td>
            <td>
                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="deleteTest('${test.id}')">O'chirish</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteTest(id) {
    data.tests = data.tests.filter(t => t.id !== id);
    saveData();
    renderTestsTable();
}

function updateResultsLevelFilter() {
    const filterSelect = document.getElementById('results-teacher-filter');
    const teacherId = filterSelect ? filterSelect.value : 'all';
    const levelSelect = document.getElementById('results-level-filter');
    if (!levelSelect) return;
    
    const currentVal = levelSelect.value;
    levelSelect.innerHTML = '<option value="all">Barchasi</option>';
    
    let relevantTests = data.tests;
    if (teacherId !== 'all') {
        relevantTests = relevantTests.filter(t => t.teacherId === teacherId);
    }
    
    const uniqueLevels = [...new Set(relevantTests.map(t => t.level))].filter(Boolean);
    uniqueLevels.forEach(lvl => {
        const option = document.createElement('option');
        option.value = lvl;
        option.textContent = lvl;
        levelSelect.appendChild(option);
    });
    
    if (uniqueLevels.includes(currentVal)) {
        levelSelect.value = currentVal;
    } else {
        levelSelect.value = 'all';
    }
}

function renderResultsTable() {
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';
    
    const filterSelect = document.getElementById('results-teacher-filter');
    let filterId = filterSelect ? filterSelect.value : 'all';
    
    const levelSelect = document.getElementById('results-level-filter');
    let filterLevel = levelSelect ? levelSelect.value : 'all';
    
    const searchInput = document.getElementById('results-student-search');
    const searchQuery = searchInput ? searchInput.value.toLowerCase() : '';
    
    if (currentLoggedInTeacherId) {
        filterId = currentLoggedInTeacherId;
    }
    
    let filteredResults = data.results;
    if (filterId !== 'all') {
        filteredResults = filteredResults.filter(r => r.teacherId === filterId);
    }
    
    if (filterLevel !== 'all') {
        filteredResults = filteredResults.filter(r => r.level === filterLevel);
    }
    
    if (searchQuery) {
        filteredResults = filteredResults.filter(r => 
            (r.firstName || '').toLowerCase().includes(searchQuery) || 
            (r.lastName || '').toLowerCase().includes(searchQuery)
        );
    }
    
    const sortedResults = [...filteredResults].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (sortedResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 3rem;"><i class="ph ph-folder-open" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem; display: block;"></i><p style="color: var(--text-light); font-size: 1.1rem;">Hozircha natijalar yo\'q</p></td></tr>';
        return;
    }
    
    sortedResults.forEach(res => {
        const teacher = data.teachers.find(t => t.id === res.teacherId);
        const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Noma\'lum';
        const date = new Date(res.date).toLocaleString();
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${res.firstName} ${res.lastName}</td>
            <td>${res.phone}</td>
            <td>${teacherName}</td>
            <td>${res.subject || '-'}</td>
            <td>${res.level}</td>
            <td><span style="color:var(--success)">${res.correct}</span> / <span style="color:var(--danger)">${res.wrong}</span></td>
            <td>${date}</td>
            <td>
                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="deleteResult('${res.id}')">O'chirish</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteResult(id) {
    data.results = data.results.filter(r => String(r.id) !== String(id));
    saveData();
    renderResultsTable();
    updateDashboardStats();
}

let currentSelectedTeacherForExport = null;

function viewTeacherStudents(teacherId) {
    currentSelectedTeacherForExport = teacherId;
    const teacher = data.teachers.find(t => t.id === teacherId);
    
    document.getElementById('teacher-students-card').classList.remove('hidden');
    document.getElementById('teacher-students-title').textContent = `${teacher.firstName} ${teacher.lastName} O'quvchilari`;
    
    const tbody = document.querySelector('#teacher-students-table tbody');
    tbody.innerHTML = '';
    
    const teacherResults = data.results.filter(r => r.teacherId === teacherId);
    
    if (teacherResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 3rem;"><i class="ph ph-user-minus" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem; display: block;"></i><p style="color: var(--text-light); font-size: 1.1rem;">Bu o\'qituvchida hozircha o\'quvchilar yo\'q</p></td></tr>';
    }
    
    teacherResults.forEach(res => {
        const date = new Date(res.date).toLocaleString();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${res.firstName} ${res.lastName}</td>
            <td>${res.phone}</td>
            <td>${res.level}</td>
            <td>${res.correct}</td>
            <td>${res.wrong}</td>
            <td>${date}</td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById('teacher-students-card').scrollIntoView({ behavior: 'smooth' });
}

function exportTeacherStudentsToExcel() {
    if (!currentSelectedTeacherForExport) return;
    
    const teacher = data.teachers.find(t => t.id === currentSelectedTeacherForExport);
    const teacherResults = data.results.filter(r => r.teacherId === currentSelectedTeacherForExport);
    
    const exportData = teacherResults.map(res => ({
        "Ism Familiya": `${res.firstName} ${res.lastName}`,
        "Telefon": res.phone,
        "Fan": res.subject || '-',
        "Daraja": res.level,
        "To'g'ri Javoblar": res.correct,
        "Xato Javoblar": res.wrong,
        "Jami Savollar": res.total,
        "Sana": new Date(res.date).toLocaleString()
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "O'quvchilar");
    
    XLSX.writeFile(workbook, `${teacher.firstName}_${teacher.lastName}_Natijalar.xlsx`);
}

function exportTeacherStudentsToPDF() {
    if (!currentSelectedTeacherForExport) return;
    const teacher = data.teachers.find(t => t.id === currentSelectedTeacherForExport);
    const teacherResults = data.results.filter(r => r.teacherId === currentSelectedTeacherForExport);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFont("helvetica", "bold");
    doc.text(`Time School - ${teacher.firstName} ${teacher.lastName} O'quvchilari`, 14, 20);
    
    const tableData = teacherResults.map(res => [
        `${res.firstName} ${res.lastName}`,
        res.phone,
        res.subject || '-',
        res.level,
        `${res.correct}/${res.wrong}`,
        new Date(res.date).toLocaleDateString()
    ]);
    
    doc.autoTable({
        startY: 30,
        head: [['O\'quvchi', 'Telefon', 'Fan', 'Daraja', 'Natija', 'Sana']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [51, 51, 51], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 4 },
        alternateRowStyles: { fillColor: [245, 245, 245] }
    });
    
    doc.save(`${teacher.firstName}_${teacher.lastName}_Natijalar.pdf`);
}

function exportResultsToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFont("helvetica", "bold");
    doc.text("Time School - Umumiy Natijalar", 14, 20);
    
    const filterSelect = document.getElementById('results-teacher-filter');
    const filterId = filterSelect ? filterSelect.value : 'all';
    
    const levelSelect = document.getElementById('results-level-filter');
    const filterLevel = levelSelect ? levelSelect.value : 'all';
    
    let filteredResults = data.results;
    if (filterId !== 'all') {
        filteredResults = filteredResults.filter(r => r.teacherId === filterId);
    }
    
    if (filterLevel !== 'all') {
        filteredResults = filteredResults.filter(r => r.level === filterLevel);
    }
    const sortedResults = [...filteredResults].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    const tableData = sortedResults.map(res => {
        const teacher = data.teachers.find(t => t.id === res.teacherId);
        const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Noma\'lum';
        return [
            `${res.firstName} ${res.lastName}`,
            res.phone,
            teacherName,
            res.level,
            `${res.correct}/${res.wrong}`,
            new Date(res.date).toLocaleDateString()
        ];
    });
    
    doc.autoTable({
        startY: 30,
        head: [['O\'quvchi', 'Telefon', 'O\'qituvchi', 'Daraja', 'Natija', 'Sana']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [51, 51, 51], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 4 },
        alternateRowStyles: { fillColor: [245, 245, 245] }
    });
    
    doc.save('TimeSchool_Natijalar.pdf');
}

function populateTeacherSelectsAdmin() {
    const selectGen = document.getElementById('gen-teacher');
    const filterSelect = document.getElementById('results-teacher-filter');
    
    if(selectGen) {
        selectGen.innerHTML = '<option value="">Tanlang...</option>';
        data.teachers.forEach(t => {
            if (currentLoggedInTeacherId && t.id !== currentLoggedInTeacherId) return;
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.firstName} ${t.lastName}`;
            selectGen.appendChild(option);
        });
        if (currentLoggedInTeacherId) {
            selectGen.value = currentLoggedInTeacherId;
            selectGen.disabled = true;
            // load subject for this teacher
            selectGen.dispatchEvent(new Event('change'));
        } else {
            selectGen.disabled = false;
        }
    }
    
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">Barchasi</option>';
        data.teachers.forEach(t => {
            if (currentLoggedInTeacherId && t.id !== currentLoggedInTeacherId) return;
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.firstName} ${t.lastName}`;
            filterSelect.appendChild(option);
        });
        if (currentLoggedInTeacherId) {
            filterSelect.value = currentLoggedInTeacherId;
            filterSelect.disabled = true;
        } else {
            filterSelect.disabled = false;
        }
    }
    
    updateResultsLevelFilter();
    
    const subjectSelect = document.getElementById('t-subjects-options');
    if (subjectSelect) {
        subjectSelect.innerHTML = '';
        data.subjects.forEach(s => {
            const div = document.createElement('div');
            div.className = 'custom-select-option';
            div.setAttribute('data-value', s);
            div.textContent = s;
            subjectSelect.appendChild(div);
        });
        
        // Reset selection UI
        const chipsContainer = document.getElementById('custom-select-chips');
        if (chipsContainer) {
            chipsContainer.innerHTML = '<span class="placeholder-text">Tanlang...</span>';
            chipsContainer.removeAttribute('data-selected-value');
        }
    }
}

// Make globally available for inline onclick attributes
window.openModal = openModal;
window.closeModal = closeModal;
window.closeAdminLogin = closeAdminLogin;
window.goToNextQuestion = goToNextQuestion;
window.deleteTeacher = deleteTeacher;
window.viewTeacherStudents = viewTeacherStudents;
window.deleteTest = deleteTest;
window.deleteResult = deleteResult;
window.deleteSubject = deleteSubject;

window.toggleSubjectDropdown = function() {
    document.getElementById('t-subjects-options').classList.toggle('active');
}

// Handle single option selection
document.addEventListener('click', function(e) {
    if (e.target && e.target.closest('.custom-select-option')) {
        const option = e.target.closest('.custom-select-option');
        const val = option.getAttribute('data-value');
        const text = option.textContent;
        
        // Update display with selected text
        const chipsContainer = document.getElementById('custom-select-chips');
        chipsContainer.innerHTML = `<span class="selected-text" style="font-weight: 600; color: var(--text-dark);">${text}</span>`;
        chipsContainer.setAttribute('data-selected-value', val);
        
        // Remove active class from all options
        document.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected-option'));
        option.classList.add('selected-option');
        
        // Close dropdown
        const dropdown = document.getElementById('t-subjects-options');
        if (dropdown) dropdown.classList.remove('active');
        
    } else if (!e.target.closest('.custom-select-wrapper')) {
        // Close if clicked outside
        const dropdown = document.getElementById('t-subjects-options');
        if (dropdown && dropdown.classList.contains('active')) {
            dropdown.classList.remove('active');
        }
    }
});
