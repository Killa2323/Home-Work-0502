// Load Transformers.js library for browser-based ML inference (loaded lazily so we can show friendly errors)
const TRANSFORMERS_CDN_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Application state
let reviewsData = [];
let aiModel = null;
let userApiKey = null;

// Cache DOM elements for better performance
const elements = {
    status: document.getElementById('statusMessage'),
    error: document.getElementById('errorMessage'),
    analyzeBtn: document.getElementById('analyzeButton'),
    reviewDisplay: document.getElementById('reviewText'),
    resultContainer: document.getElementById('resultBox'),
    resultIconEl: document.getElementById('resultIcon'),
    resultLabelEl: document.getElementById('resultLabel'),
    resultConfEl: document.getElementById('resultConfidence'),
    spinner: document.getElementById('loadingSpinner'),
    tokenInput: document.getElementById('apiTokenInput')
};

function getLocalServerHint() {
    return `Open this page via a local server (not file://). Example: run "python -m http.server 8000" in the project folder and open http://localhost:8000/`;
}

function enrichErrorMessage(err) {
    const base = err?.message ? String(err.message) : String(err);

    if (window.location.protocol === 'file:') {
        return `${base}\n\n${getLocalServerHint()}`;
    }

    if (base.includes('Failed to fetch') || base.includes('NetworkError')) {
        return `${base}\n\nIf you're running locally, make sure reviews_test.tsv is served by your dev server and that you have internet access (the AI model loads from CDN).`;
    }

    return base;
}


// UI Helper Functions
function setStatus(text, statusType = 'loading') {
    const iconMap = {
        loading: 'fa-circle-notch fa-spin',
        ready: 'fa-check-circle',
        error: 'fa-exclamation-circle'
    };
    
    elements.status.innerHTML = `<i class="fas ${iconMap[statusType]}"></i><span>${text}</span>`;
    elements.status.className = `status-bar status-${statusType}`;
}

function displayError(errorText) {
    elements.error.textContent = errorText;
    elements.error.style.display = 'block';
    console.error('[App Error]:', errorText);
}

function clearError() {
    elements.error.style.display = 'none';
}


// Data Loading Functions
async function fetchAndParseReviews() {
    setStatus('Fetching review data...', 'loading');
    
    try {
        const res = await fetch('reviews_test.tsv');
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: Cannot load TSV file`);
        }
        
        const rawTSV = await res.text();
        
        // Parse TSV using PapaParse
        return new Promise((resolve, reject) => {
            Papa.parse(rawTSV, {
                header: true,
                delimiter: '\t',
                skipEmptyLines: true,
                complete: (parseResult) => {
                    if (parseResult.errors.length > 0) {
                        console.warn('[TSV Parse] Warnings detected:', parseResult.errors);
                    }
                    
                    // Extract and validate reviews from 'text' column
                    const validReviews = parseResult.data
                        .map(row => row.text)
                        .filter(txt => txt && typeof txt === 'string' && txt.trim());
                    
                    if (validReviews.length === 0) {
                        reject(new Error('No valid review texts found in TSV'));
                    } else {
                        console.log(`[Data] Loaded ${validReviews.length} reviews`);
                        resolve(validReviews);
                    }
                },
                error: (err) => {
                    reject(new Error(`Parse error: ${err.message}`));
                }
            });
        });
    } catch (err) {
        displayError(`Review loading failed: ${enrichErrorMessage(err)}`);
        throw err;
    }
}


// AI Model Setup
async function setupSentimentModel() {
    try {
        setStatus('Loading AI model (first run may take ~1 minute)...', 'loading');
        
        const { pipeline } = await import(TRANSFORMERS_CDN_URL);

        // Initialize sentiment classification pipeline
        aiModel = await pipeline(
            'text-classification',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
        );
        
        setStatus('AI model ready! Click button to analyze.', 'ready');
        console.log('[Model] Successfully loaded');
        return true;
    } catch (err) {
        const msg = `Model initialization failed: ${enrichErrorMessage(err)}`;
        setStatus(msg, 'error');
        displayError(msg);
        throw err;
    }
}

// Review Selection
function pickRandomReview() {
    if (reviewsData.length === 0) {
        throw new Error('No reviews in dataset');
    }
    return reviewsData[Math.floor(Math.random() * reviewsData.length)];
}

// Sentiment Analysis
async function classifySentiment(reviewText) {
    if (!aiModel) {
        throw new Error('AI model not ready');
    }
    
    // Run model inference - returns array like [{label: "POSITIVE", score: 0.99}]
    const predictions = await aiModel(reviewText);
    return predictions[0]; // Take top prediction
}

// Sentiment Mapping
function categorizeSentiment(prediction) {
    const { label, score } = prediction;
    
    // Map to three categories based on label and confidence
    if (label === 'POSITIVE' && score > 0.5) {
        return {
            category: 'positive',
            displayLabel: 'POSITIVE',
            confidenceScore: score,
            iconClass: 'fa-thumbs-up'
        };
    } else if (label === 'NEGATIVE' && score > 0.5) {
        return {
            category: 'negative',
            displayLabel: 'NEGATIVE',
            confidenceScore: score,
            iconClass: 'fa-thumbs-down'
        };
    } else {
        return {
            category: 'neutral',
            displayLabel: 'NEUTRAL',
            confidenceScore: score,
            iconClass: 'fa-question-circle'
        };
    }
}


// UI Update Functions
function renderSentimentResult(sentimentData) {
    const { category, displayLabel, confidenceScore, iconClass } = sentimentData;
    
    // Apply styling based on category
    elements.resultContainer.className = `sentiment-result ${category}`;
    elements.resultContainer.style.display = 'block';
    
    // Set icon
    elements.resultIconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;
    
    // Set label text
    elements.resultLabelEl.textContent = displayLabel;
    
    // Format and display confidence percentage
    const percentage = (confidenceScore * 100).toFixed(1);
    elements.resultConfEl.textContent = `Confidence: ${percentage}%`;
}

// Analytics Logging
async function logAnalyticsData(reviewText, sentimentLabel, confidence, metadata) {
    // ВСТАВЬТЕ СЮДА ВАШ WEB APP URL
    const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxYKpZv0qKOcgX_-5lvGY1QIz0F17QLti7hzg-2hwXkoudpVFcS6HF8ebG_MgNpyQFxUA/exec';
    
    try {
        const timestamp = new Date().toISOString();
        
        const analyticsPayload = {
            ts_iso: timestamp,
            event: 'sentiment_analysis',
            variant: 'B',
            userId: metadata.userId || 'guest',
            meta: JSON.stringify({
                page: metadata.page || window.location.href,
                ua: navigator.userAgent,
                sentiment: sentimentLabel,
                confidence: confidence
            }),
            review: reviewText,
            sentiment_label: sentimentLabel,
            sentiment_confidence: confidence
        };
        
        console.log('[Analytics] Sending to Google Sheets:', analyticsPayload);
        
        // Отправка данных в Google Sheets.
        // Важно: многие шаблоны Google Apps Script читают POST-поля из e.parameter,
        // поэтому отправляем application/x-www-form-urlencoded (а не JSON), чтобы колонки не были пустыми.
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(analyticsPayload)) {
            if (value === undefined || value === null) continue;
            params.set(key, String(value));
        }

        await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors', // Важно для Google Apps Script
            body: params
        });
        
        console.log('[Analytics] Data sent successfully');
        
    } catch (err) {
        console.error('[Analytics] Logging failed:', err);
        // Don't throw - analytics failure shouldn't break the app
    }
}


// Main Analysis Workflow
async function performAnalysis() {
    try {
        clearError();
        
        // Validate data availability
        if (reviewsData.length === 0) {
            displayError('No review data loaded. Please refresh.');
            return;
        }
        
        // UI: Show loading state
        elements.analyzeBtn.disabled = true;
        elements.spinner.style.display = 'block';
        elements.resultContainer.style.display = 'none';
        
        // Step 1: Pick random review
        const chosenReview = pickRandomReview();
        elements.reviewDisplay.textContent = chosenReview;
        
        // Step 2: Run AI classification
        const rawPrediction = await classifySentiment(chosenReview);
        
        // Step 3: Map to UI format
        const sentimentResult = categorizeSentiment(rawPrediction);
        
        // Step 4: Display results
        renderSentimentResult(sentimentResult);
        
        // Step 5: Log analytics (optional) - don't block the UI on logging
        void logAnalyticsData(
            chosenReview,
            sentimentResult.displayLabel,
            sentimentResult.confidenceScore,
            {
                userId: `user-${Date.now()}`,
                page: window.location.href
            }
        );
        
    } catch (err) {
        displayError(`Analysis error: ${err.message}`);
    } finally {
        // UI: Reset state
        elements.analyzeBtn.disabled = false;
        elements.spinner.style.display = 'none';
    }
}


// App Initialization
async function initializeApp() {
    try {
        if (window.location.protocol === 'file:') {
            const msg = `This app can't run from a file URL (file://) because it needs fetch() + ES modules.\n\n${getLocalServerHint()}`;
            setStatus('Open via local server to start.', 'error');
            displayError(msg);
            return;
        }

        // Phase 1: Load review dataset
        reviewsData = await fetchAndParseReviews();
        console.log(`[Init] Dataset ready: ${reviewsData.length} reviews`);
        
        // Phase 2: Load AI model
        await setupSentimentModel();
        
        // Enable analyze button
        elements.analyzeBtn.disabled = false;
        
    } catch (err) {
        console.error('[Init] Startup failed:', err);
        const msg = `Initialization error: ${enrichErrorMessage(err)}`;
        setStatus('Initialization error. Check error message.', 'error');
        displayError(msg);
    }
}

// Event Handlers
elements.analyzeBtn.addEventListener('click', performAnalysis);

elements.tokenInput.addEventListener('input', (event) => {
    userApiKey = event.target.value.trim();
    
    // Persist to browser storage
    if (userApiKey) {
        localStorage.setItem('hf_api_token', userApiKey);
    }
});

// App Startup
function startApp() {
    // Restore saved API token
    const savedKey = localStorage.getItem('hf_api_token');
    if (savedKey) {
        elements.tokenInput.value = savedKey;
        userApiKey = savedKey;
    }
    
    // Start app
    initializeApp();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
