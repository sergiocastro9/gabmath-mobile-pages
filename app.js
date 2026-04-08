const state = {
  stream: null,
  scanTimer: null,
  proof: null,
  answers: {},
};

const QR_PAYLOAD_PREFIX = "GABMATH1:";

const video = document.getElementById("qr-video");
const startScanButton = document.getElementById("start-scan");
const stopScanButton = document.getElementById("stop-scan");
const loadProofButton = document.getElementById("load-proof");
const proofIdInput = document.getElementById("proof-id-input");
const scanStatus = document.getElementById("scan-status");
const proofPanel = document.getElementById("proof-panel");
const proofSummary = document.getElementById("proof-summary");
const answerGrid = document.getElementById("answer-grid");
const correctProofButton = document.getElementById("correct-proof");
const resultPanel = document.getElementById("result-panel");
const cardImageInput = document.getElementById("card-image-input");
const cardPreview = document.getElementById("card-preview");

startScanButton.addEventListener("click", startQrScanner);
stopScanButton.addEventListener("click", stopQrScanner);
loadProofButton.addEventListener("click", () => loadProof(proofIdInput.value));
correctProofButton.addEventListener("click", correctProof);
cardImageInput.addEventListener("change", onCardImageChange);

async function startQrScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera nao disponivel neste navegador.");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    video.srcObject = state.stream;
    await video.play();
    setStatus("Aponte a camera para o QR Code da prova.");
    startBarcodeLoop();
  } catch (error) {
    setStatus(`Falha ao abrir a camera: ${error.message}`);
  }
}

function stopQrScanner() {
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
    state.scanTimer = null;
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  video.srcObject = null;
}

function startBarcodeLoop() {
  if (!("BarcodeDetector" in window)) {
    setStatus("Leitura automatica de QR nao suportada aqui. Digite o codigo manualmente.");
    return;
  }

  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
  }

  state.scanTimer = setInterval(async () => {
    if (!video.srcObject) {
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (!codes.length) {
        return;
      }
      const rawValue = codes[0].rawValue?.trim();
      if (!rawValue) {
        return;
      }
      proofIdInput.value = rawValue;
      stopQrScanner();
      setStatus(`QR lido: ${rawValue}`);
      loadProof(rawValue);
    } catch (error) {
      setStatus(`Falha na leitura do QR: ${error.message}`);
      stopQrScanner();
    }
  }, 700);
}

function loadProof(rawValue) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    setStatus("Informe ou leia um codigo de prova.");
    return;
  }

  try {
    state.proof = parseQrPayload(normalized);
    state.answers = {};
    renderProof();
    proofPanel.classList.remove("hidden");
    resultPanel.classList.add("hidden");
    resultPanel.innerHTML = "";
    setStatus("Prova carregada. Agora registre as respostas do cartao.");
  } catch (error) {
    proofPanel.classList.add("hidden");
    setStatus(error.message);
  }
}

function renderProof() {
  if (!state.proof) {
    return;
  }

  proofSummary.innerHTML = `
    <div><strong>Prova:</strong> ${escapeHtml(state.proof.id_prova || "")}</div>
    <div><strong>Aluno:</strong> ${escapeHtml(state.proof.aluno || "")}</div>
    <div><strong>Turma:</strong> ${escapeHtml(state.proof.turma || "")}</div>
    <div><strong>Questoes:</strong> ${Number(state.proof.quantidade_questoes || 0)}</div>
  `;

  answerGrid.innerHTML = "";
  for (const question of state.proof.questoes || []) {
    const row = document.createElement("div");
    row.className = "answer-row";
    const label = document.createElement("div");
    label.className = "answer-label";
    label.textContent = `Q.${question.numero}`;
    row.appendChild(label);

    for (const letter of ["A", "B", "C", "D", "E"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-btn";
      button.textContent = letter;
      button.addEventListener("click", () => selectAnswer(question.numero, letter, row));
      row.appendChild(button);
    }

    answerGrid.appendChild(row);
  }
}

function selectAnswer(questionNumber, letter, row) {
  state.answers[String(questionNumber)] = letter;
  for (const button of row.querySelectorAll(".choice-btn")) {
    button.classList.toggle("selected", button.textContent === letter);
  }
}

function correctProof() {
  if (!state.proof) {
    setStatus("Nenhuma prova foi carregada.");
    return;
  }

  const data = correctProofLocally(state.proof, state.answers);
  resultPanel.classList.remove("hidden");
  resultPanel.classList.toggle("wrong", data.acertos !== data.total);
  resultPanel.innerHTML = `
    <div><strong>Aluno:</strong> ${escapeHtml(data.aluno || "")}</div>
    <div><strong>Acertos:</strong> ${data.acertos} de ${data.total}</div>
    <div><strong>Nota:</strong> ${data.nota}</div>
  `;
}

function correctProofLocally(proof, answers) {
  const details = [];
  let correct = 0;
  for (const question of proof.questoes || []) {
    const marked = String(answers[String(question.numero)] || "").toUpperCase();
    const expected = String(question.correta_letra || "").toUpperCase();
    const hit = marked === expected;
    if (hit) {
      correct += 1;
    }
    details.push({
      numero: question.numero,
      marcada: marked,
      correta: expected,
      acertou: hit,
    });
  }
  const total = details.length;
  return {
    aluno: proof.aluno || "",
    acertos: correct,
    total,
    nota: total ? Math.round((correct / total) * 1000) / 100 : 0,
    detalhes: details,
  };
}

function parseQrPayload(rawValue) {
  const normalized = String(rawValue || "").trim();
  if (!normalized.startsWith(QR_PAYLOAD_PREFIX)) {
    throw new Error("QR Code incompatível com o modo web fixo.");
  }

  const encoded = normalized.slice(QR_PAYLOAD_PREFIX.length);
  const jsonText = decodeBase64Url(encoded);
  const payload = JSON.parse(jsonText);
  const answerKey = String(payload.g || "").toUpperCase();
  const questions = Array.from(answerKey).map((letter, index) => ({
    numero: index + 1,
    correta_letra: letter,
  }));

  return {
    id_prova: payload.id || "",
    aluno: payload.a || "",
    turma: payload.t || "",
    disciplina: payload.d || "",
    quantidade_questoes: Number(payload.n || questions.length),
    questoes: questions,
  };
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function onCardImageChange(event) {
  const [file] = event.target.files || [];
  if (!file) {
    cardPreview.classList.add("hidden");
    cardPreview.removeAttribute("src");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    cardPreview.src = String(reader.result);
    cardPreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function setStatus(text) {
  scanStatus.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
