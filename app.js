let data = {
    teachers: [],
    tests: [],
    results: [],
    subjects: []
};

async function loadDataFromBackend() {
    try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok) {
            const serverData = await res.json();
            data.teachers = serverData.teachers || [];
            data.tests = serverData.tests || [];
            data.results = serverData.results || [];
            data.subjects = serverData.subjects || [
                "Ingliz tili", "Matematika", "Ona tili", "Fizika", "Tarix", 
                "Kimyo", "Biologiya", "Geografiya", "Informatika", "Adabiyot", "Rus tili"
            ];
            
            updateDashboardStats();
            renderTeachersTable();
            renderTestsTable();
            renderResultsTable();
            populateTeacherSelectsAdmin();
            populateTeachersForStudent();
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

// Modals
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function closeAdminLogin() {
    closeModal('admin-login-modal');
}

document.addEventListener('DOMContentLoaded', () => {
    loadDataFromBackend();
    
    // Mode Selection
    document.getElementById('btn-student-mode').addEventListener('click', () => {
        document.getElementById('mode-selector').classList.add('hidden');
        document.getElementById('student-app').classList.remove('hidden');
        populateTeachersForStudent();
    });

    document.getElementById('btn-admin-login-mode').addEventListener('click', () => {
        openModal('admin-login-modal');
    });
    
    document.getElementById('admin-login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const user = document.getElementById('admin-username').value;
        const pass = document.getElementById('admin-password').value;
        
        if (user === '452' && pass === '187') {
            closeModal('admin-login-modal');
            document.getElementById('mode-selector').classList.add('hidden');
            document.getElementById('admin-app').classList.remove('hidden');
            e.target.reset();
            initAdminPanel();
        } else {
            alert('Login yoki parol noto\'g\'ri! (login: admin, parol: admin123)');
        }
    });

    // ================= STUDENT LOGIC =================
    document.getElementById('student-form').addEventListener('submit', handleStartTest);
    document.getElementById('test-form').addEventListener('submit', handleFinishTest);
    
    document.getElementById('teacherSelect').addEventListener('change', function() {
        const teacherId = this.value;
        const subjectSelect = document.getElementById('studentSubjectSelect');
        const levelSelect = document.getElementById('levelSelect');
        
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
                
                // Auto-select if only 1 subject
                if (teacher.subjects.length === 1) {
                    subjectSelect.value = teacher.subjects[0];
                    subjectSelect.dispatchEvent(new Event('change'));
                }
            }
        } else {
            subjectSelect.innerHTML = '<option value="">Oldin o\'qituvchini tanlang</option>';
        }
    });

    document.getElementById('studentSubjectSelect').addEventListener('change', function() {
        const subject = this.value;
        const levelSelect = document.getElementById('levelSelect');
        
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
    
    // Close modal if clicked outside
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.classList.remove('active');
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

function renderTestQuestions() {
    const container = document.getElementById('questions-container');
    container.innerHTML = '';
    
    const questionsToRender = currentTest.questions.slice(0, 50);
    
    questionsToRender.forEach((q, index) => {
        const block = document.createElement('div');
        block.className = 'question-block';
        block.id = `qb-${index}`;
        block.style.display = index === 0 ? 'block' : 'none';
        
        let optionsHTML = '';
        q.options.forEach((opt, optIndex) => {
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
        if (selectedOption !== null && parseInt(selectedOption) === q.correctAnswerIndex) {
            correctCount++;
        } else {
            wrongCount++;
        }
    });
    
    const resultObj = {
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
    populateTeacherSelectsAdmin();
    renderResultsTable();
    
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
    document.getElementById('generate-test-form').addEventListener('submit', handleGenerateTest);
    
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
    document.getElementById('results-teacher-filter').addEventListener('change', renderResultsTable);
}

function updateDashboardStats() {
    const totalStudents = data.results.map(r => r.phone).filter((v, i, a) => a.indexOf(v) === i).length;
    
    document.getElementById('stat-total-students').textContent = totalStudents;
    document.getElementById('stat-total-tests').textContent = data.results.length;
    document.getElementById('stat-total-teachers').textContent = data.teachers.length;
    
    // Render recent results
    const recentTbody = document.querySelector('#recent-results-table tbody');
    if (recentTbody) {
        recentTbody.innerHTML = '';
        const recentResults = [...data.results].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
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
            recentTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">Hozircha natijalar yo\'q</td></tr>';
        }
    }
}

function handleAddTeacher(e) {
    e.preventDefault();
    const firstName = document.getElementById('t-firstName').value;
    const lastName = document.getElementById('t-lastName').value;
    const phone = document.getElementById('t-phone').value;
    
    // Get selected subjects
    const subjectSelect = document.getElementById('t-subjects');
    const subjects = Array.from(subjectSelect.selectedOptions).map(opt => opt.value).filter(v => v !== "");
    
    if (subjects.length === 0) {
        alert("Iltimos, kamida bitta fanni belgilang!");
        return;
    }
    
    const newTeacher = {
        id: Date.now().toString(),
        firstName,
        lastName,
        phone,
        subjects
    };
    
    data.teachers.push(newTeacher);
    saveData();
    updateDashboardStats();
    renderTeachersTable();
    populateTeacherSelectsAdmin();
    e.target.reset();
    closeModal('add-teacher-modal');
    alert("O'qituvchi muvaffaqiyatli qo'shildi!");
}

function renderTeachersTable() {
    const tbody = document.querySelector('#teachers-table tbody');
    tbody.innerHTML = '';
    
    data.teachers.forEach(teacher => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${teacher.firstName} ${teacher.lastName}</td>
            <td>${teacher.phone}</td>
            <td>${teacher.subjects.join(', ')}</td>
            <td>
                <button class="btn" style="padding: 5px 10px; font-size: 0.8rem;" onclick="viewTeacherStudents('${teacher.id}')">O'quvchilar</button>
                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem; margin-left: 5px;" onclick="deleteTeacher('${teacher.id}')">O'chirish</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteTeacher(id) {
    if (confirm("Rostdan ham bu o'qituvchini o'chirmoqchimisiz?")) {
        data.teachers = data.teachers.filter(t => t.id !== id);
        saveData();
        renderTeachersTable();
        populateTeacherSelectsAdmin();
        updateDashboardStats();
    }
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
    alert("Fan muvaffaqiyatli qo'shildi!");
}

function renderSubjectsTable() {
    const tbody = document.querySelector('#subjects-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
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
    if (confirm("Rostdan ham bu fanni o'chirmoqchimisiz?")) {
        data.subjects = data.subjects.filter(s => s !== subject);
        saveData();
        renderSubjectsTable();
        populateTeacherSelectsAdmin();
    }
}

async function handleGenerateTest(e) {
    e.preventDefault();
    
    const teacherId = document.getElementById('gen-teacher').value;
    const subject = document.getElementById('gen-subject').value;
    const level = document.getElementById('gen-level').value;
    const duration = parseInt(document.getElementById('gen-duration').value) || 60;
    const promptText = document.getElementById('gen-prompt').value;
    
    if (!teacherId || !subject || !level) {
        alert("Iltimos, o'qituvchi, fan va darajani tanlang!");
        return;
    }
    
    const testExists = data.tests.find(t => t.teacherId === teacherId && t.subject === subject && t.level === level);
    if(testExists) {
        if(!confirm("Ushbu daraja va fan uchun test allaqachon mavjud. Yana bitta variant yaratmoqchimisiz? (O'quvchilarga tasodifiy variant tushadi)")) {
            return;
        }
    }

    const loadingOverlay = document.getElementById('loading');
    loadingOverlay.classList.add('active');

    const prompt = `Generate exactly 50 multiple-choice questions for ${subject} at ${level} level in Uzbek language. 
    Additional instructions: ${promptText}.
    Return the response ONLY as a valid JSON array of objects. Do NOT include any markdown code blocks, do NOT include \`\`\`json. Just the raw array.
    Each object must have this exact structure:
    {"question": "Question text here?", "options": ["Option 1", "Option 2", "Option 3", "Option 4"], "correctAnswerIndex": 0}
    Ensure correctAnswerIndex is an integer from 0 to 3.`;

    try {
        const response = await fetch('/api/generate-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subject: subject,
                level: level,
                promptText: promptText
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Serverdan xato keldi.");
        }

        const result = await response.json();
        const questions = result.questions;
        
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new Error("Yaratilgan savollar ro'yxati bo'sh yoki noto'g'ri.");
        }

        // No longer deleting old tests to allow multiple variants
        
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
        alert("Test muvaffaqiyatli yaratildi!");

    } catch (error) {
        console.error("AI xatosi:", error);
        alert("Test yaratishda xatolik yuz berdi. Xato: " + error.message);
    } finally {
        loadingOverlay.classList.remove('active');
    }
}

function renderTestsTable() {
    const tbody = document.querySelector('#tests-table tbody');
    tbody.innerHTML = '';
    
    data.tests.forEach(test => {
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
    if (confirm("Ushbu testni o'chirmoqchimisiz?")) {
        data.tests = data.tests.filter(t => t.id !== id);
        saveData();
        renderTestsTable();
    }
}

function renderResultsTable() {
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';
    
    const filterSelect = document.getElementById('results-teacher-filter');
    const filterId = filterSelect ? filterSelect.value : 'all';
    
    let filteredResults = data.results;
    if (filterId !== 'all') {
        filteredResults = filteredResults.filter(r => r.teacherId === filterId);
    }
    
    const sortedResults = [...filteredResults].sort((a, b) => new Date(b.date) - new Date(a.date));
    
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
    if (confirm("Ushbu natijani o'chirmoqchimisiz?")) {
        data.results = data.results.filter(r => r.id !== id);
        saveData();
        renderResultsTable();
        updateDashboardStats();
    }
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
        headStyles: { fillColor: [255, 193, 7], textColor: [51, 51, 51] }
    });
    
    doc.save(`${teacher.firstName}_${teacher.lastName}_Natijalar.pdf`);
}

function exportResultsToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFont("helvetica", "bold");
    doc.text("Time School - Umumiy Natijalar", 14, 20);
    
    const tableData = data.results.map(res => {
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
        headStyles: { fillColor: [255, 193, 7], textColor: [51, 51, 51] }
    });
    
    doc.save('TimeSchool_Natijalar.pdf');
}

function populateTeacherSelectsAdmin() {
    const selectGen = document.getElementById('gen-teacher');
    const filterSelect = document.getElementById('results-teacher-filter');
    
    if(selectGen) {
        selectGen.innerHTML = '<option value="">Tanlang...</option>';
        data.teachers.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.firstName} ${t.lastName}`;
            selectGen.appendChild(option);
        });
    }
    
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">Barchasi</option>';
        data.teachers.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.firstName} ${t.lastName}`;
            filterSelect.appendChild(option);
        });
    }
    
    const subjectSelect = document.getElementById('t-subjects');
    if (subjectSelect) {
        subjectSelect.innerHTML = '<option value="">Tanlang...</option>';
        data.subjects.forEach(s => {
            const option = document.createElement('option');
            option.value = s;
            option.textContent = s;
            subjectSelect.appendChild(option);
        });
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
