class ArithmeticVisualizer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.inputString = options.initialText || "aba";
        
        this.currentIndex = 0;
        this.autoStepInterval = null;
        this.onFinish = null; // callback to feed decoder

        // State
        this.freqTable = {};
        this.symbols = []; // Ordered keys
        this.currentLow = 0;
        this.currentHigh = 1;
        this.levels = [];

        this.renderShell();
        this.setupEventListeners();
        this.reset();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="controls-bar" style="margin-bottom: 1rem;">
                <input type="text" class="input-text" id="arith-input" value="${this.inputString}" placeholder="Enter text to compress..." style="width: 100%;">
            </div>
            <div class="controls-bar" style="margin-bottom: 2rem; justify-content: space-between;">
                <div style="color: var(--text-secondary); font-size: 0.9rem;">
                    Note: Native JS math limits precision for strings longer than ~12 chars.
                </div>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn" id="arith-btn-reset">Reset</button>
                    <button class="btn" id="arith-btn-prev" disabled>Previous</button>
                    <button class="btn" id="arith-btn-step">Step</button>
                    <button class="btn btn-secondary" id="arith-btn-auto">Auto Play</button>
                </div>
            </div>

            <div class="vis-container">
                <div class="string-view" id="arith-string-view" style="font-size: 2rem;"></div>
                
                <div class="lz78-layout">
                    <div class="dictionary-panel">
                        <h3>Frequency Table</h3>
                        <table class="dict-table" id="arith-freq-table">
                            <thead>
                                <tr>
                                    <th>Char</th>
                                    <th>Prob</th>
                                    <th>Range [L, H)</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>

                    <div class="tree-panel" style="overflow-x: auto; overflow-y: visible; min-height: 300px;">
                        <h3>Interval Stack</h3>
                        <div style="position: relative; padding-top: 20px;" id="arith-svg-container">
                            <svg width="100%" height="300" id="arith-svg" style="overflow: visible;"></svg>
                        </div>
                    </div>
                </div>

                <div class="data-panel">
                    <h3>Final Encoded Output</h3>
                    <div class="output-stream" id="arith-output" style="font-size: 1.2rem; min-height: 40px;"></div>
                </div>
            </div>
        `;

        this.stringView = this.container.querySelector('#arith-string-view');
        this.freqTbody = this.container.querySelector('#arith-freq-table tbody');
        this.svg = this.container.querySelector('#arith-svg');
        this.svgContainer = this.container.querySelector('#arith-svg-container');
        this.outputView = this.container.querySelector('#arith-output');

        this.inputEl = this.container.querySelector('#arith-input');
        this.btnReset = this.container.querySelector('#arith-btn-reset');
        this.btnPrev = this.container.querySelector('#arith-btn-prev');
        this.btnStep = this.container.querySelector('#arith-btn-step');
        this.btnAuto = this.container.querySelector('#arith-btn-auto');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => {
            this.inputString = this.inputEl.value;
            this.reset();
        });
        this.btnPrev.addEventListener('click', () => this.previous());
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());
        this.inputEl.addEventListener('change', (e) => {
            this.inputString = e.target.value;
            this.reset();
        });
    }

    buildFreqTable() {
        let counts = {};
        for(let c of this.inputString) {
            counts[c] = (counts[c] || 0) + 1;
        }
        this.symbols = Object.keys(counts).sort();
        let len = this.inputString.length;
        
        let low = 0;
        this.freqTable = {};
        for (let sym of this.symbols) {
            let prob = counts[sym] / len;
            let high = low + prob;
            this.freqTable[sym] = { prob, low, high };
            low = high;
        }
    }

    reset() {
        this.stopAutoStep();
        this.currentIndex = 0;
        this.currentLow = 0;
        this.currentHigh = 1;
        this.levels = [];
        this.outputView.innerHTML = '';
        this.history = [];
        this.btnPrev.disabled = true;
        
        this.buildFreqTable();

        this.btnStep.disabled = false;
        if(this.inputString.length === 0) {
            this.btnStep.disabled = true;
            this.outputView.innerHTML = "No input string.";
        }
        
        // Push initial [0, 1) state
        this.levels.push({ charIndex: -1, char: null, rangeLow: 0, rangeHigh: 1 });
        
        // Sync decoder out of the gate with reset data
        if(this.onFinish) this.onFinish(null, this.inputString.length, this.freqTable);

        this.renderState();
    }

    toggleAutoStep() {
        if (this.autoStepInterval) {
            this.stopAutoStep();
        } else {
            this.autoStepInterval = setInterval(() => {
                if (this.currentIndex >= this.inputString.length) {
                    this.stopAutoStep();
                } else {
                    this.step();
                }
            }, 1000);
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
        if (this.currentIndex >= this.inputString.length) return;
        
        this.history.push({
            currentIndex: this.currentIndex,
            currentLow: this.currentLow,
            currentHigh: this.currentHigh,
            levels: JSON.parse(JSON.stringify(this.levels)),
            outputHTML: this.outputView.innerHTML
        });
        this.btnPrev.disabled = false;

        let ch = this.inputString[this.currentIndex];
        let symData = this.freqTable[ch];

        let range = this.currentHigh - this.currentLow;
        this.currentHigh = this.currentLow + range * symData.high;
        this.currentLow = this.currentLow + range * symData.low;

        this.levels.push({
            charIndex: this.currentIndex,
            char: ch,
            rangeLow: this.currentLow,
            rangeHigh: this.currentHigh
        });

        this.currentIndex++;
        this.renderState();

        if (this.currentIndex >= this.inputString.length) {
            this.btnStep.disabled = true;
            this.stopAutoStep();
            
            // Pick value slightly inside range to emulate encoded bitstream
            // (Standard arithmetic encoders just output native float or arbitrary precision bits. We emit standard float.)
            let encodedVal = this.currentLow + (this.currentHigh - this.currentLow) * 0.5;
            this.outputView.innerHTML = `<strong>Interval:</strong> [${this.currentLow}, ${this.currentHigh}) <br/><strong>Picked Value:</strong> <span style="color:var(--accent-green)">${encodedVal}</span>`;
            
            if(this.onFinish) this.onFinish(encodedVal, this.inputString.length, this.freqTable);
        }
    }
    
    previous() {
        if (this.history.length === 0) return;
        let state = this.history.pop();
        
        this.currentIndex = state.currentIndex;
        this.currentLow = state.currentLow;
        this.currentHigh = state.currentHigh;
        this.levels = state.levels;
        this.outputView.innerHTML = state.outputHTML;
        
        if (this.history.length === 0) this.btnPrev.disabled = true;
        this.btnStep.disabled = false;
        if(this.onFinish) this.onFinish(null, this.inputString.length, this.freqTable);
        this.renderState();
    }

    renderState() {
        // Render String
        this.stringView.innerHTML = '';
        for (let i = 0; i < this.inputString.length; i++) {
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = this.inputString[i] === ' ' ? '␣' : this.inputString[i];
            
            if (i < this.currentIndex) {
               cell.classList.add('matched');
            } else if (i === this.currentIndex) {
               cell.classList.add('current-target');
            }
            this.stringView.appendChild(cell);
        }

        // Render Freq Table
        this.freqTbody.innerHTML = '';
        for(let sym of this.symbols) {
            let tr = document.createElement('tr');
            let data = this.freqTable[sym];
            tr.innerHTML = `
                <td>${sym === ' ' ? '␣' : sym}</td>
                <td>${data.prob.toFixed(4)}</td>
                <td>[${data.low.toFixed(4)}, ${data.high.toFixed(4)})</td>
            `;
            // Highlight row if it is the current char
            if (this.currentIndex > 0 && this.currentIndex <= this.inputString.length && sym === this.inputString[this.currentIndex - 1]) {
                 tr.classList.add('new-entry');
            }
            this.freqTbody.appendChild(tr);
        }

        this.renderSVG();
    }

    renderSVG() {
        this.svg.innerHTML = '';
        let levelHeight = 80;
        let svgHeight = this.levels.length * levelHeight + 30; // 30px bottom padding
        this.svg.setAttribute('height', svgHeight);
        
        let containerWidth = this.svgContainer.clientWidth || 800;
        
        const formatFloat = (num) => {
            let str = num.toPrecision(7);
            if(str.length > 10) str = num.toExponential(4);
            return str;
        };

        const drawBar = (yOffset, mathLow, mathHigh, activeSym) => {
            let g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute('transform', `translate(0, ${yOffset})`);

            let currentX = 0;
            let activeBounds = null; // {x1, x2} to draw connecting lines later

            for(let sym of this.symbols) {
                let symInfo = this.freqTable[sym];
                let w = symInfo.prob * containerWidth;
                
                let rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute('x', currentX);
                rect.setAttribute('y', 0);
                rect.setAttribute('width', w);
                rect.setAttribute('height', 30);
                
                if (sym === activeSym) {
                    rect.setAttribute('fill', 'rgba(52, 211, 153, 0.4)'); // accent-green glow
                    rect.setAttribute('stroke', 'var(--accent-green)');
                    rect.setAttribute('stroke-width', '2');
                    activeBounds = { x1: currentX, x2: currentX + w };
                } else {
                    rect.setAttribute('fill', 'var(--bg-card)');
                    rect.setAttribute('stroke', 'var(--border-color)');
                    rect.setAttribute('stroke-width', '1');
                }
                
                let txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
                txt.setAttribute('x', currentX + w/2);
                txt.setAttribute('y', 20);
                txt.setAttribute('text-anchor', 'middle');
                txt.setAttribute('fill', 'var(--text-primary)');
                txt.setAttribute('font-size', '14px');
                txt.textContent = sym === ' ' ? '␣' : sym;
                
                g.appendChild(rect);
                
                // Hide text if extremely squished
                if (w > 15) g.appendChild(txt);
                
                // Add partition ticks
                if (currentX > 0) {
                   let tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
                   tick.setAttribute('x1', currentX);
                   tick.setAttribute('y1', -5);
                   tick.setAttribute('x2', currentX);
                   tick.setAttribute('y2', 35);
                   tick.setAttribute('stroke', 'var(--border-color)');
                   g.appendChild(tick);
                }

                currentX += w;
            }

            // Lables Low High
            let lblLow = document.createElementNS("http://www.w3.org/2000/svg", "text");
            lblLow.setAttribute('x', 0);
            lblLow.setAttribute('y', -8);
            lblLow.setAttribute('fill', 'var(--text-secondary)');
            lblLow.setAttribute('font-size', '12px');
            lblLow.textContent = formatFloat(mathLow);
            g.appendChild(lblLow);
            
            let lblHigh = document.createElementNS("http://www.w3.org/2000/svg", "text");
            lblHigh.setAttribute('x', containerWidth);
            lblHigh.setAttribute('y', -8);
            lblHigh.setAttribute('text-anchor', 'end');
            lblHigh.setAttribute('fill', 'var(--text-secondary)');
            lblHigh.setAttribute('font-size', '12px');
            lblHigh.textContent = formatFloat(mathHigh);
            g.appendChild(lblHigh);

            return { group: g, activeBounds: activeBounds };
        };

        for (let i = 0; i < this.levels.length; i++) {
            let l = this.levels[i];
            let y = i * levelHeight;
            
            // Which symbol is active for the NEXT transition?
            let activeSym = null;
            if (i < this.levels.length - 1) {
                activeSym = this.levels[i+1].char;
            } else if (i === this.levels.length - 1 && this.currentIndex < this.inputString.length) {
                activeSym = this.inputString[this.currentIndex];
            }

            let rendered = drawBar(y, l.rangeLow, l.rangeHigh, activeSym);
            this.svg.appendChild(rendered.group);

            // Connect previous active block to this full bar
            if (i > 0) {
                let prev = this.levels[i-1];
                let prevActiveSym = l.char;
                let prevInfo = this.freqTable[prevActiveSym];
                
                let prevX1 = prevInfo.low * containerWidth;
                let prevX2 = prevInfo.high * containerWidth;
                
                let line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line1.setAttribute('x1', prevX1);
                line1.setAttribute('y1', y - levelHeight + 30);
                line1.setAttribute('x2', 0);
                line1.setAttribute('y2', y - 5); // Connect to top of current bar
                line1.setAttribute('stroke', 'var(--accent-green)');
                line1.setAttribute('stroke-dasharray', '4,4');
                this.svg.appendChild(line1);

                let line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line2.setAttribute('x1', prevX2);
                line2.setAttribute('y1', y - levelHeight + 30);
                line2.setAttribute('x2', containerWidth);
                line2.setAttribute('y2', y - 5);
                line2.setAttribute('stroke', 'var(--accent-green)');
                line2.setAttribute('stroke-dasharray', '4,4');
                this.svg.appendChild(line2);
            }
        }
    }
}


class ArithmeticDecoderVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        
        // Incoming payload
        this.encodedValue = null;
        this.targetLength = 0;
        this.freqTable = null;
        
        // State
        this.reconstructedString = "";
        this.currentValue = null;
        this.currentStep = 0;
        
        this.autoStepInterval = null;

        this.renderShell();
        this.setupEventListeners();
    }

    setTokens(encodedValue, length, freqTable) {
        this.encodedValue = encodedValue;
        this.targetLength = length;
        this.freqTable = freqTable;
        this.reset();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="controls-bar" style="margin-bottom: 1rem; justify-content: space-between; align-items: start;">
                <div style="flex:1; display:flex; flex-direction:column; gap:0.5rem; max-width: 60%;">
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">
                        Float, length, and frequency table are fed from the encoder automatically. 
                        <strong>Arithmetic Decoding reverses the probability mapping.</strong>
                    </div>
                </div>
                <div style="display:flex; gap:1rem;">
                    <button class="btn" id="arith-dec-btn-reset">Reset</button>
                    <button class="btn" id="arith-dec-btn-prev" disabled>Previous</button>
                    <button class="btn" id="arith-dec-btn-step">Step Decoder</button>
                    <button class="btn btn-secondary" id="arith-dec-btn-auto">Auto Decode</button>
                </div>
            </div>
            
            <div class="vis-container">
                <div class="data-panel" style="flex: none; display: flex; gap: 2rem;">
                    <div>
                        <h3 style="margin-bottom:0">Encoded Value</h3>
                        <div id="arith-dec-encoded-view" style="font-size: 1.5rem; color: var(--accent-orange); font-family:var(--font-mono); font-weight:bold;">Waiting...</div>
                    </div>
                    <div>
                        <h3 style="margin-bottom:0">Target Length</h3>
                        <div id="arith-dec-len-view" style="font-size: 1.5rem; color: var(--text-primary); font-family:var(--font-mono);">0</div>
                    </div>
                </div>

                <div class="lz78-layout">
                    <div class="data-panel" style="flex:1; display:flex; flex-direction:column; justify-content: center; align-items: center; min-height: 200px;">
                        <h3>Reconstructed String</h3>
                        <div class="string-view" id="arith-dec-string-view" style="font-size:3rem; gap:1rem;"></div>
                    </div>
                </div>
                
                <div class="data-panel">
                    <h3>Decoder Math (Rescaling)</h3>
                    <div class="output-stream" id="arith-dec-math-log" style="font-family: var(--font-mono); font-size: 0.9rem; flex-direction: column; align-items: stretch; gap: 0.2rem;"></div>
                </div>
            </div>
        `;

        this.valView = this.container.querySelector('#arith-dec-encoded-view');
        this.lenView = this.container.querySelector('#arith-dec-len-view');
        this.stringView = this.container.querySelector('#arith-dec-string-view');
        this.mathLog = this.container.querySelector('#arith-dec-math-log');
        
        this.btnReset = this.container.querySelector('#arith-dec-btn-reset');
        this.btnPrev = this.container.querySelector('#arith-dec-btn-prev');
        this.btnStep = this.container.querySelector('#arith-dec-btn-step');
        this.btnAuto = this.container.querySelector('#arith-dec-btn-auto');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => this.reset());
        this.btnPrev.addEventListener('click', () => this.previous());
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());
    }

    reset() {
        this.stopAutoStep();
        this.reconstructedString = "";
        this.currentStep = 0;
        this.currentValue = this.encodedValue;
        
        this.history = [];
        this.btnPrev.disabled = true;
        
        this.btnStep.disabled = false;
        if (this.encodedValue === null || this.targetLength === 0) {
            this.btnStep.disabled = true;
        }

        this.renderState();
        this.mathLog.innerHTML = '';
        if(this.encodedValue !== null) {
            this.logMath(`Initialization: Loaded Val = ${this.encodedValue}`);
        }
    }

    toggleAutoStep() {
        if (this.autoStepInterval) {
            this.stopAutoStep();
        } else {
            this.autoStepInterval = setInterval(() => {
                if (this.currentStep >= this.targetLength) {
                    this.stopAutoStep();
                } else {
                    this.step();
                }
            }, 600);
            this.btnAuto.innerText = "Stop Auto";
            this.btnAuto.classList.remove('btn-secondary');
        }
    }

    stopAutoStep() {
        if (this.autoStepInterval) {
            clearInterval(this.autoStepInterval);
            this.autoStepInterval = null;
        }
        this.btnAuto.innerText = "Auto Decode";
        this.btnAuto.classList.add('btn-secondary');
    }

    logMath(msg, isNewStep = false) {
        let div = document.createElement('div');
        if (isNewStep) {
            div.style.marginTop = '1rem';
            div.style.paddingTop = '1rem';
            div.style.borderTop = '1px solid var(--border-color)';
        }
        div.innerHTML = msg;
        this.mathLog.appendChild(div);
        this.mathLog.scrollTop = this.mathLog.scrollHeight;
    }

    step() {
        if (this.currentStep >= this.targetLength) return;
        
        this.history.push({
            currentStep: this.currentStep,
            currentValue: this.currentValue,
            reconstructedString: this.reconstructedString,
            mathLogHTML: this.mathLog.innerHTML
        });
        this.btnPrev.disabled = false;
        
        let foundChar = null;
        let foundData = null;
        
        // Find which character's probability interval contains currentValue
        for (let sym in this.freqTable) {
            let data = this.freqTable[sym];
            if (this.currentValue >= data.low && this.currentValue < data.high) {
                // To avoid edge case float precision failures at the absolute max bounds
                foundChar = sym;
                foundData = data;
                break;
            }
        }
        
        if (!foundChar) {
            // Failsafe due to float precision limits
            this.logMath(`<span style="color:var(--accent-orange)">Float precision limit reached. Cannot find sub-interval for ${this.currentValue}.</span>`);
            this.btnStep.disabled = true;
            this.stopAutoStep();
            return;
        }

        this.reconstructedString += foundChar;
        
        this.logMath(`Step ${this.currentStep + 1}: Found '${foundChar}' inside [${foundData.low.toFixed(4)}, ${foundData.high.toFixed(4)}).`, true);
        
        // Rescale for next iteration
        let oldVal = this.currentValue;
        this.currentValue = (this.currentValue - foundData.low) / foundData.prob;
        this.logMath(`&nbsp;&nbsp;&nbsp;&nbsp;Rescaling value: (${oldVal} - ${foundData.low}) / ${foundData.prob.toFixed(4)} = <strong>${this.currentValue}</strong>`);

        this.currentStep++;
        
        this.renderState({ justAppended: true });

        if (this.currentStep >= this.targetLength) {
            this.btnStep.disabled = true;
            this.stopAutoStep();
            this.logMath(`<strong>Decoding complete. stringLength reached.</strong>`);
        }
    }
    
    previous() {
        if (this.history.length === 0) return;
        let state = this.history.pop();
        
        this.currentStep = state.currentStep;
        this.currentValue = state.currentValue;
        this.reconstructedString = state.reconstructedString;
        this.mathLog.innerHTML = state.mathLogHTML;
        
        if (this.history.length === 0) this.btnPrev.disabled = true;
        this.btnStep.disabled = false;
        this.renderState();
    }

    renderState(highlightInfo = null) {
        this.valView.innerText = this.encodedValue === null ? "Waiting..." : this.currentValue;
        this.lenView.innerText = `${this.currentStep} / ${this.targetLength}`;

        this.stringView.innerHTML = '';

        for (let i = 0; i < this.reconstructedString.length; i++) {
            let char = this.reconstructedString[i];
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = char === ' ' ? '␣' : char;

            if (highlightInfo && highlightInfo.justAppended && i === this.reconstructedString.length - 1) {
                cell.classList.add('matched');
                cell.style.transform = "scale(1.2)";
                setTimeout(() => cell.style.transform = "scale(1)", 300);
            }

            this.stringView.appendChild(cell);
        }
    }
}
