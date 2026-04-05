const RS_GF_EXP = new Array(512);
const RS_GF_LOG = new Array(256);
let x = 1;
for (let i = 0; i < 255; i++) {
    RS_GF_EXP[i] = x;
    RS_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
        x ^= 0x11D;
    }
}
for (let i = 255; i < 512; i++) {
    RS_GF_EXP[i] = RS_GF_EXP[i - 255];
}

function gfAdd(x, y) { return x ^ y; }
function gfMul(x, y) {
    if (x === 0 || y === 0) return 0;
    return RS_GF_EXP[RS_GF_LOG[x] + RS_GF_LOG[y]];
}

function buildGenerator(eccLength) {
    let g = [1];
    for (let i = 0; i < eccLength; i++) {
        let a = RS_GF_EXP[i];
        let nextG = new Array(g.length + 1).fill(0);
        for(let j = 0; j < g.length; j++) {
            nextG[j] = gfAdd(nextG[j], g[j]);
            nextG[j+1] = gfAdd(nextG[j+1], gfMul(g[j], a));
        }
        g = nextG;
    }
    return g;
}

function toHex(val) {
    return val.toString(16).padStart(2, '0').toUpperCase();
}

class ReedSolomonEncoderVisualizer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.inputString = options.initialText || "hello";
        this.eccLength = 4;
        
        // State
        this.messageBytes = [];
        this.generator = [];
        this.parityBytes = [];
        this.currentStep = 0;
        
        this.autoStepInterval = null;

        this.renderShell();
        this.setupEventListeners();
        this.reset();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="controls-bar" style="margin-bottom: 1rem;">
                <input type="text" class="input-text" id="rs-input" value="${this.inputString}" placeholder="Enter text to encode..." style="width: 100%;">
            </div>
            <div class="controls-bar" style="margin-bottom: 2rem; justify-content: space-between;">
                <div style="display:flex; gap:1rem; align-items:center;">
                    <label>Parity Bytes (ECC Length): 
                        <input type="number" id="rs-ecc-size" class="input-text" style="width:60px; min-width:0; padding:0.5rem" value="${this.eccLength}" min="2" max="10">
                    </label>
                </div>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn" id="rs-btn-reset">Reset</button>
                    <button class="btn" id="rs-btn-prev" disabled>Previous</button>
                    <button class="btn" id="rs-btn-step">Step</button>
                    <button class="btn btn-secondary" id="rs-btn-auto">Auto Play</button>
                </div>
            </div>

            <div class="vis-container">
                <div class="data-panel" style="flex:1; display:flex; flex-direction:column; justify-content: center; min-height: 100px;">
                    <h3>Generator Polynomial (GF(2^8))</h3>
                    <div class="string-view" id="rs-gen-view" style="font-size:1.5rem; gap:0.5rem; flex-wrap:wrap; align-content: flex-start;"></div>
                </div>

                <div class="data-panel" style="flex:1; display:flex; flex-direction:column; justify-content: center; min-height: 250px;">
                    <h3>LFSR Division Process 
                        <span style="font-size:0.8rem; font-weight:normal; color:var(--text-secondary); float:right;">Msg[i] XOR Parity[0] -> Multiply Generator</span>
                    </h3>
                    
                    <div style="display:flex; gap: 2rem; align-items:flex-start; margin-bottom: 1rem;">
                        <div>
                            <div style="color:var(--text-secondary); font-size: 0.8rem; margin-bottom: 0.5rem;">Message Bytes</div>
                            <div class="string-view" id="rs-msg-view" style="font-size:2rem; gap:0.5rem; flex-wrap:wrap;"></div>
                        </div>
                    </div>
                    
                    <div style="display:flex; gap:1rem; align-items:center; margin-bottom: 1rem; min-height: 40px;" id="rs-math-row">
                        <!-- Dynamic Math showing Feedback calculation -->
                    </div>

                    <div>
                        <div style="color:var(--text-secondary); font-size: 0.8rem; margin-bottom: 0.5rem;">Parity Register (Remainder)</div>
                        <div class="string-view" id="rs-parity-view" style="font-size:2rem; gap:0.5rem;"></div>
                    </div>
                </div>
                
                <div class="data-panel">
                    <h3>Final Systematic Output</h3>
                    <div class="string-view" id="rs-final-view" style="font-size:2rem; gap:0.5rem;">Waiting...</div>
                </div>
            </div>
        `;

        this.inputEl = this.container.querySelector('#rs-input');
        this.eccInput = this.container.querySelector('#rs-ecc-size');
        
        this.genView = this.container.querySelector('#rs-gen-view');
        this.msgView = this.container.querySelector('#rs-msg-view');
        this.mathRow = this.container.querySelector('#rs-math-row');
        this.parityView = this.container.querySelector('#rs-parity-view');
        this.finalView = this.container.querySelector('#rs-final-view');

        this.btnReset = this.container.querySelector('#rs-btn-reset');
        this.btnPrev = this.container.querySelector('#rs-btn-prev');
        this.btnStep = this.container.querySelector('#rs-btn-step');
        this.btnAuto = this.container.querySelector('#rs-btn-auto');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => {
            this.inputString = this.inputEl.value;
            this.eccLength = parseInt(this.eccInput.value);
            this.reset();
        });
        this.btnPrev.addEventListener('click', () => this.previous());
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());
        this.inputEl.addEventListener('change', (e) => {
            this.inputString = e.target.value;
            this.reset();
        });
        this.eccInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value);
            if (val >= 2 && val <= 10) {
                this.eccLength = val;
                this.reset();
            }
        });
    }

    reset() {
        this.stopAutoStep();
        this.currentStep = 0;
        
        this.generator = buildGenerator(this.eccLength);
        
        this.messageBytes = [];
        for(let i=0; i<this.inputString.length; i++) {
            this.messageBytes.push(this.inputString.charCodeAt(i));
        }
        
        this.parityBytes = new Array(this.eccLength).fill(0);
        
        this.history = [];
        this.btnPrev.disabled = true;

        this.btnStep.disabled = false;
        if(this.messageBytes.length === 0) this.btnStep.disabled = true;

        this.renderState();
        this.mathRow.innerHTML = '';
        this.finalView.innerHTML = '<span style="color:var(--text-secondary)">Waiting to finish division...</span>';
    }

    toggleAutoStep() {
        if (this.autoStepInterval) {
            this.stopAutoStep();
        } else {
            this.autoStepInterval = setInterval(() => {
                if (this.currentStep >= this.messageBytes.length) {
                    this.stopAutoStep();
                } else {
                    this.step();
                }
            }, 800);
            this.btnAuto.innerText = "Stop Auto";
            this.btnAuto.classList.remove('btn-secondary');
        }
    }

    stopAutoStep() {
        if (this.autoStepInterval) {
            clearInterval(this.autoStepInterval);
            this.autoStepInterval = null;
        }
        this.btnAuto.innerText = "Auto Play";
        this.btnAuto.classList.add('btn-secondary');
    }

    step() {
        if (this.currentStep >= this.messageBytes.length) return;
        
        this.history.push({
            currentStep: this.currentStep,
            parityBytes: [...this.parityBytes],
            mathRowHTML: this.mathRow.innerHTML,
            finalViewHTML: this.finalView.innerHTML
        });
        this.btnPrev.disabled = false;

        let msgByte = this.messageBytes[this.currentStep];
        let leadParity = this.parityBytes[0];
        let feedback = gfAdd(msgByte, leadParity);
        
        // Show math logic
        this.mathRow.innerHTML = `
            <div style="background:var(--bg-card); padding:0.5rem 1rem; border-radius:4px; border:1px solid var(--accent-orange); font-family:var(--font-mono);">
                Feedback = (MsgByte: <b style="color:var(--accent-orange)">${toHex(msgByte)}</b>) ⊕ (LeadParity: <b style="color:var(--accent-blue)">${toHex(leadParity)}</b>) 
                = <b style="color:var(--accent-green)">${toHex(feedback)}</b>
            </div>
            ${feedback !== 0 ? `<div style="color:var(--accent-green); font-size:0.9rem;">→ Shift parity and XOR with Generator*Feedback</div>` : `<div style="color:var(--text-secondary); font-size:0.9rem;">→ Shift parity only (Feedback is 0)</div>`}
        `;

        // Shift parity array left
        let newParity = new Array(this.eccLength).fill(0);
        for(let j=0; j<this.eccLength-1; j++) {
            newParity[j] = this.parityBytes[j+1];
        }
        
        // XOR with generator
        if (feedback !== 0) {
            for(let j=0; j<this.eccLength; j++) {
                // Ignore g[0] which is 1
                newParity[j] = gfAdd(newParity[j], gfMul(feedback, this.generator[j+1]));
            }
        }
        
        this.parityBytes = newParity;
        
        this.currentStep++;
        this.renderState({ activeFeedback: feedback, activeLead: leadParity });

        if (this.currentStep >= this.messageBytes.length) {
            this.btnStep.disabled = true;
            this.stopAutoStep();
            
            // Render Final Payload
            this.finalView.innerHTML = '';
            for(let i=0; i<this.messageBytes.length; i++) {
                let cell = document.createElement('div');
                cell.className = 'char-cell';
                cell.innerText = toHex(this.messageBytes[i]);
                this.finalView.appendChild(cell);
            }
            for(let i=0; i<this.eccLength; i++) {
                let cell = document.createElement('div');
                cell.className = 'char-cell matched';
                cell.style.borderColor = 'var(--accent-green)';
                cell.innerText = toHex(this.parityBytes[i]);
                this.finalView.appendChild(cell);
            }
        }
    }
    
    previous() {
        if (this.history.length === 0) return;
        let state = this.history.pop();
        
        this.currentStep = state.currentStep;
        this.parityBytes = state.parityBytes;
        this.mathRow.innerHTML = state.mathRowHTML;
        this.finalView.innerHTML = state.finalViewHTML;
        
        if (this.history.length === 0) this.btnPrev.disabled = true;
        this.btnStep.disabled = false;
        this.renderState();
    }

    renderState(highlightInfo = null) {
        // Gen Polynomial
        this.genView.innerHTML = '';
        for(let i=0; i<this.generator.length; i++) {
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.style.fontSize = "1rem";
            cell.style.padding = "0.5rem";
            cell.innerHTML = `g<sub>${this.generator.length - 1 - i}</sub> = <span style="font-weight:bold; color:var(--accent-purple)">${toHex(this.generator[i])}</span>`;
            this.genView.appendChild(cell);
        }

        // Message
        this.msgView.innerHTML = '';
        for (let i = 0; i < this.messageBytes.length; i++) {
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = toHex(this.messageBytes[i]);
            
            if (i < this.currentStep - (highlightInfo ? 1 : 0)) {
               cell.style.filter = "brightness(0.3)";
               let ascii = document.createElement("div");
               ascii.innerText = String.fromCharCode(this.messageBytes[i]);
               ascii.style.fontSize = "0.8rem";
               ascii.style.color = "var(--text-secondary)";
               cell.appendChild(ascii);
            } else if (i === this.currentStep - (highlightInfo ? 1 : 0) && highlightInfo) {
               // Currently processing
               cell.style.borderColor = "var(--accent-orange)";
               cell.style.boxShadow = "0 0 10px rgba(249, 115, 22, 0.5)";
            } else if (i === this.currentStep && !highlightInfo) {
               // Up next
               cell.style.borderColor = "var(--accent-orange)";
            }
            this.msgView.appendChild(cell);
        }

        // Parity
        this.parityView.innerHTML = '';
        for (let i = 0; i < this.parityBytes.length; i++) {
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = toHex(this.parityBytes[i]);
            
            if (highlightInfo) {
                // We just updated it. Flash green to show new state
                cell.classList.add('matched');
            }
            this.parityView.appendChild(cell);
        }
    }
}
