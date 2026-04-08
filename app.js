const state = {
  stream: null,
  qrTimer: null,
  cardTimer: null,
  proof: null,
  answers: {},
  phase: "idle",
  opencvReady: false,
  stableSignature: "",
  stableCount: 0,
  currentVideoDeviceId: "",
};

const QR_PAYLOAD_PREFIX = "GABMATH1:";
const CARD_TARGET = {
  width: 820,
  height: 1160,
  leftMarkerX: 130,
  rightMarkerX: 690,
  topMarkerY: 180,
  bottomMarkerY: 1010,
};

const video = document.getElementById("camera-video");
const overlayCanvas = document.getElementById("camera-overlay");
const alignedCanvas = document.getElementById("aligned-preview");
const startScanButton = document.getElementById("start-scan");
const stopScanButton = document.getElementById("stop-scan");
const loadProofButton = document.getElementById("load-proof");
const nextProofButton = document.getElementById("next-proof");
const proofIdInput = document.getElementById("proof-id-input");
const scanStatus = document.getElementById("scan-status");
const modeBadge = document.getElementById("mode-badge");
const proofPanel = document.getElementById("proof-panel");
const proofSummary = document.getElementById("proof-summary");
const answerGrid = document.getElementById("answer-grid");
const correctProofButton = document.getElementById("correct-proof");
const resultPanel = document.getElementById("result-panel");

const captureCanvas = document.createElement("canvas");

startScanButton.addEventListener("click", startWorkflow);
stopScanButton.addEventListener("click", stopWorkflow);
loadProofButton.addEventListener("click", () => loadProof(proofIdInput.value, true));
correctProofButton.addEventListener("click", correctProof);
nextProofButton.addEventListener("click", resetForNextProof);

bootstrap();

function bootstrap() {
  setPhase("idle");
  waitForOpenCv();
}

function waitForOpenCv() {
  if (window.cv && typeof window.cv.Mat === "function") {
    state.opencvReady = true;
    setStatus("OpenCV carregado. Inicie a leitura do QR Code.");
    return;
  }

  setStatus("Carregando motor de leitura do cartao-resposta...");
  const timer = window.setInterval(() => {
    if (window.cv && typeof window.cv.Mat === "function") {
      window.clearInterval(timer);
      state.opencvReady = true;
      setStatus("OpenCV carregado. Inicie a leitura do QR Code.");
    }
  }, 250);
}

async function startWorkflow() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera nao disponivel neste navegador.");
    return;
  }

  stopLoops();
  clearOverlay();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    const [track] = stream.getVideoTracks();
    state.currentVideoDeviceId = track?.getSettings?.().deviceId || "";
    proofPanel.classList.add("hidden");
    resultPanel.classList.add("hidden");
    resultPanel.innerHTML = "";
    setPhase("qr");
    setStatus("Aponte a camera para o QR Code. Nao precisa tirar foto.");
    startQrLoop();
  } catch (error) {
    setStatus(`Falha ao abrir a camera: ${error.message}`);
  }
}

function stopWorkflow() {
  stopLoops();
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  video.srcObject = null;
  state.phase = "idle";
  clearOverlay();
  setPhase("idle");
  setStatus("Leitura interrompida.");
}

function stopLoops() {
  if (state.qrTimer) {
    window.clearInterval(state.qrTimer);
    state.qrTimer = null;
  }
  if (state.cardTimer) {
    window.clearInterval(state.cardTimer);
    state.cardTimer = null;
  }
}

function startQrLoop() {
  if (!("BarcodeDetector" in window)) {
    setStatus("Leitura automatica de QR nao suportada aqui. Cole o conteudo do QR manualmente.");
    return;
  }

  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  state.qrTimer = window.setInterval(async () => {
    if (state.phase !== "qr" || !video.srcObject) {
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (!codes.length) {
        return;
      }
      const rawValue = String(codes[0].rawValue || "").trim();
      if (!rawValue) {
        return;
      }
      proofIdInput.value = rawValue;
      loadProof(rawValue, false);
    } catch (error) {
      setStatus(`Falha na leitura do QR: ${error.message}`);
    }
  }, 400);
}

function loadProof(rawValue, manual) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    setStatus("Informe ou leia um codigo de prova.");
    return;
  }

  try {
    state.proof = parseQrPayload(normalized);
    state.answers = {};
    state.stableSignature = "";
    state.stableCount = 0;
    renderProof();
    proofPanel.classList.remove("hidden");
    resultPanel.classList.add("hidden");
    resultPanel.innerHTML = "";
    setPhase("card");
    if (manual && !state.stream) {
      setStatus("Prova carregada. Inicie a camera para ler o cartao-resposta.");
    } else {
      setStatus("QR lido. Agora centralize apenas o cartao-resposta na camera.");
      startCardLoop();
    }
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
    row.dataset.question = String(question.numero);

    const label = document.createElement("div");
    label.className = "answer-label";
    label.textContent = `Q.${question.numero}`;
    row.appendChild(label);

    for (const letter of ["A", "B", "C", "D", "E"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-btn";
      button.textContent = letter;
      button.addEventListener("click", () => selectAnswer(question.numero, letter));
      row.appendChild(button);
    }

    answerGrid.appendChild(row);
  }

  updateRenderedAnswers();
}

function selectAnswer(questionNumber, letter) {
  state.answers[String(questionNumber)] = letter;
  updateRenderedAnswers();
}

function updateRenderedAnswers() {
  for (const row of answerGrid.querySelectorAll(".answer-row")) {
    const questionNumber = row.dataset.question;
    const selected = state.answers[String(questionNumber)] || "";
    for (const button of row.querySelectorAll(".choice-btn")) {
      button.classList.toggle("selected", button.textContent === selected);
    }
  }
}

function setPhase(phase) {
  state.phase = phase;
  const labels = {
    idle: "Aguardando",
    qr: "Lendo QR",
    card: "Lendo cartao",
  };
  modeBadge.textContent = labels[phase] || "Aguardando";
}

function startCardLoop() {
  if (!state.opencvReady) {
    setStatus("OpenCV ainda nao terminou de carregar.");
    return;
  }

  if (state.qrTimer) {
    window.clearInterval(state.qrTimer);
    state.qrTimer = null;
  }

  state.cardTimer = window.setInterval(() => {
    if (state.phase !== "card" || !video.srcObject || !state.proof) {
      return;
    }

    const detection = detectCardAnswers(video, state.proof.quantidade_questoes);
    if (!detection) {
      state.stableSignature = "";
      state.stableCount = 0;
      setStatus("QR identificado. Centralize apenas o cartao-resposta.");
      return;
    }

    drawOverlay(detection.corners);
    drawAlignedPreview(detection.debugImageData);

    const signature = answersSignature(detection.answers, state.proof.quantidade_questoes);
    if (signature === state.stableSignature) {
      state.stableCount += 1;
    } else {
      state.stableSignature = signature;
      state.stableCount = 1;
    }

    state.answers = { ...detection.answers };
    updateRenderedAnswers();
    setStatus(`Cartao detectado. Estabilizando leitura... ${state.stableCount}/3`);

    if (state.stableCount >= 3) {
      window.clearInterval(state.cardTimer);
      state.cardTimer = null;
      setStatus("Leitura do cartao concluida.");
      correctProof();
    }
  }, 350);
}

function detectCardAnswers(videoElement, questionCount) {
  if (videoElement.videoWidth < 100 || videoElement.videoHeight < 100) {
    return null;
  }

  captureCanvas.width = videoElement.videoWidth;
  captureCanvas.height = videoElement.videoHeight;
  const captureContext = captureCanvas.getContext("2d", { willReadFrequently: true });
  captureContext.drawImage(videoElement, 0, 0, captureCanvas.width, captureCanvas.height);

  const src = cv.imread(captureCanvas);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const thresh = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(blur, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const markers = collectMarkerCandidates(contours, captureCanvas.width, captureCanvas.height);
    if (markers.length < 4) {
      return null;
    }

    const corners = orderCorners(markers.slice(0, 4).map((marker) => marker.center));
    const warped = perspectiveWarp(gray, corners);
    const debugColor = new cv.Mat();
    cv.cvtColor(warped, debugColor, cv.COLOR_GRAY2RGBA);
    const answers = readAnswersFromWarped(warped, debugColor, questionCount);
    const debugImageData = matToImageData(debugColor);

    warped.delete();
    debugColor.delete();

    return { corners, answers, debugImageData };
  } finally {
    src.delete();
    gray.delete();
    blur.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function collectMarkerCandidates(contours, width, height) {
  const candidates = [];
  const minArea = (width * height) * 0.00012;

  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index);
    const area = cv.contourArea(contour);
    if (area < minArea) {
      contour.delete();
      continue;
    }

    const perimeter = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, perimeter * 0.04, true);
    const rect = cv.boundingRect(contour);
    const aspect = rect.width / Math.max(rect.height, 1);
    const fillRatio = area / Math.max(rect.width * rect.height, 1);

    if (
      approx.rows === 4 &&
      aspect > 0.7 &&
      aspect < 1.3 &&
      fillRatio > 0.55 &&
      rect.width > 10 &&
      rect.height > 10
    ) {
      const moments = cv.moments(contour);
      if (moments.m00 !== 0) {
        candidates.push({
          area,
          center: {
            x: moments.m10 / moments.m00,
            y: moments.m01 / moments.m00,
          },
        });
      }
    }

    approx.delete();
    contour.delete();
  }

  candidates.sort((left, right) => right.area - left.area);

  const unique = [];
  for (const candidate of candidates) {
    const duplicate = unique.some((item) => distance(item.center, candidate.center) < 20);
    if (!duplicate) {
      unique.push(candidate);
    }
    if (unique.length >= 12) {
      break;
    }
  }

  if (unique.length < 4) {
    return [];
  }

  let best = null;
  const limit = Math.min(unique.length, 8);
  for (let a = 0; a < limit - 3; a += 1) {
    for (let b = a + 1; b < limit - 2; b += 1) {
      for (let c = b + 1; c < limit - 1; c += 1) {
        for (let d = c + 1; d < limit; d += 1) {
          const combo = [unique[a], unique[b], unique[c], unique[d]];
          const ordered = orderCorners(combo.map((item) => item.center));
          const score = rectangleScore(ordered);
          if (!best || score > best.score) {
            best = { score, markers: combo };
          }
        }
      }
    }
  }

  return best ? best.markers : unique.slice(0, 4);
}

function rectangleScore(points) {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const widthTop = distance(topLeft, topRight);
  const widthBottom = distance(bottomLeft, bottomRight);
  const heightLeft = distance(topLeft, bottomLeft);
  const heightRight = distance(topRight, bottomRight);
  const widthBalance = 1 - Math.abs(widthTop - widthBottom) / Math.max(widthTop, widthBottom, 1);
  const heightBalance = 1 - Math.abs(heightLeft - heightRight) / Math.max(heightLeft, heightRight, 1);
  const angleScore = parallelismScore(topLeft, topRight, bottomLeft, bottomRight);
  const areaScore = (widthTop + widthBottom) * (heightLeft + heightRight);
  return areaScore * widthBalance * heightBalance * angleScore;
}

function parallelismScore(topLeft, topRight, bottomLeft, bottomRight) {
  const topAngle = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
  const bottomAngle = Math.atan2(bottomRight.y - bottomLeft.y, bottomRight.x - bottomLeft.x);
  const leftAngle = Math.atan2(bottomLeft.y - topLeft.y, bottomLeft.x - topLeft.x);
  const rightAngle = Math.atan2(bottomRight.y - topRight.y, bottomRight.x - topRight.x);
  const horizontal = 1 - Math.min(Math.abs(topAngle - bottomAngle), Math.PI) / Math.PI;
  const vertical = 1 - Math.min(Math.abs(leftAngle - rightAngle), Math.PI) / Math.PI;
  return Math.max(0.1, horizontal * vertical);
}

function perspectiveWarp(grayMat, corners) {
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[3].x, corners[3].y,
    corners[2].x, corners[2].y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    CARD_TARGET.leftMarkerX, CARD_TARGET.topMarkerY,
    CARD_TARGET.rightMarkerX, CARD_TARGET.topMarkerY,
    CARD_TARGET.leftMarkerX, CARD_TARGET.bottomMarkerY,
    CARD_TARGET.rightMarkerX, CARD_TARGET.bottomMarkerY,
  ]);
  const matrix = cv.getPerspectiveTransform(srcTri, dstTri);
  const warped = new cv.Mat();
  cv.warpPerspective(
    grayMat,
    warped,
    matrix,
    new cv.Size(CARD_TARGET.width, CARD_TARGET.height),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(255, 255, 255, 255),
  );
  srcTri.delete();
  dstTri.delete();
  matrix.delete();
  return warped;
}

function readAnswersFromWarped(warpedGray, debugColor, questionCount) {
  const answers = {};
  const thresholded = new cv.Mat();
  cv.threshold(warpedGray, thresholded, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const stepX = (CARD_TARGET.rightMarkerX - CARD_TARGET.leftMarkerX) / 6;
  const stepY = (CARD_TARGET.bottomMarkerY - CARD_TARGET.topMarkerY) / (questionCount + 1);
  const bubbleRadius = Math.min(stepX, stepY) * 0.34;
  const sampleRadius = bubbleRadius * 0.58;

  for (let questionIndex = 1; questionIndex <= questionCount; questionIndex += 1) {
    const centerY = CARD_TARGET.topMarkerY + (stepY * questionIndex);
    const scores = [];

    for (let optionIndex = 1; optionIndex <= 5; optionIndex += 1) {
      const centerX = CARD_TARGET.leftMarkerX + (stepX * optionIndex);
      const score = sampleBubbleScore(thresholded, centerX, centerY, sampleRadius);
      scores.push(score);

      cv.circle(
        debugColor,
        new cv.Point(Math.round(centerX), Math.round(centerY)),
        Math.round(bubbleRadius),
        new cv.Scalar(90, 140, 220, 255),
        2,
      );
    }

    const bestScore = Math.max(...scores);
    const bestIndex = scores.indexOf(bestScore);
    const sortedScores = [...scores].sort((left, right) => right - left);
    const secondScore = sortedScores[1] || 0;
    const letter = resolveMarkedLetter(bestIndex, bestScore, secondScore);

    if (letter) {
      answers[String(questionIndex)] = letter;
      const markedCenterX = CARD_TARGET.leftMarkerX + (stepX * (bestIndex + 1));
      cv.circle(
        debugColor,
        new cv.Point(Math.round(markedCenterX), Math.round(centerY)),
        Math.max(4, Math.round(sampleRadius * 0.55)),
        new cv.Scalar(35, 180, 80, 255),
        -1,
      );
    }
  }

  thresholded.delete();
  return answers;
}

function sampleBubbleScore(binaryMat, centerX, centerY, radius) {
  let whitePixels = 0;
  let totalPixels = 0;

  const startX = Math.max(0, Math.floor(centerX - radius));
  const endX = Math.min(binaryMat.cols - 1, Math.ceil(centerX + radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endY = Math.min(binaryMat.rows - 1, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) > radiusSquared) {
        continue;
      }
      totalPixels += 1;
      if (binaryMat.ucharPtr(y, x)[0] > 0) {
        whitePixels += 1;
      }
    }
  }

  return totalPixels ? whitePixels / totalPixels : 0;
}

function resolveMarkedLetter(bestIndex, bestScore, secondScore) {
  if (bestScore < 0.18) {
    return "";
  }
  if (secondScore > bestScore * 0.78) {
    return "";
  }
  return ["A", "B", "C", "D", "E"][bestIndex] || "";
}

function answersSignature(answers, questionCount) {
  const values = [];
  for (let index = 1; index <= questionCount; index += 1) {
    values.push(answers[String(index)] || "-");
  }
  return values.join("");
}

function drawOverlay(corners) {
  const width = video.clientWidth || video.videoWidth || 1;
  const height = video.clientHeight || video.videoHeight || 1;
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const context = overlayCanvas.getContext("2d");
  context.clearRect(0, 0, width, height);

  const scaleX = width / video.videoWidth;
  const scaleY = height / video.videoHeight;

  context.strokeStyle = "#3ad07d";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(corners[0].x * scaleX, corners[0].y * scaleY);
  context.lineTo(corners[1].x * scaleX, corners[1].y * scaleY);
  context.lineTo(corners[2].x * scaleX, corners[2].y * scaleY);
  context.lineTo(corners[3].x * scaleX, corners[3].y * scaleY);
  context.closePath();
  context.stroke();

  for (const point of corners) {
    context.fillStyle = "#3ad07d";
    context.beginPath();
    context.arc(point.x * scaleX, point.y * scaleY, 6, 0, Math.PI * 2);
    context.fill();
  }
}

function clearOverlay() {
  const context = overlayCanvas.getContext("2d");
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const previewContext = alignedCanvas.getContext("2d");
  previewContext.clearRect(0, 0, alignedCanvas.width, alignedCanvas.height);
}

function drawAlignedPreview(imageData) {
  if (!imageData) {
    return;
  }
  alignedCanvas.width = imageData.width;
  alignedCanvas.height = imageData.height;
  const context = alignedCanvas.getContext("2d");
  context.putImageData(imageData, 0, 0);
}

function matToImageData(mat) {
  const rgba = new Uint8ClampedArray(mat.data);
  return new ImageData(rgba, mat.cols, mat.rows);
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
    throw new Error("QR Code incompativel com o modo web fixo.");
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

function resetForNextProof() {
  state.proof = null;
  state.answers = {};
  state.stableSignature = "";
  state.stableCount = 0;
  proofIdInput.value = "";
  proofPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");
  resultPanel.innerHTML = "";
  clearOverlay();
  if (state.stream) {
    setPhase("qr");
    setStatus("Aponte a camera para o proximo QR Code.");
    startQrLoop();
  } else {
    setPhase("idle");
    setStatus("Inicie a camera para ler a proxima prova.");
  }
}

function setStatus(text) {
  scanStatus.textContent = text;
}

function orderCorners(points) {
  const bySum = [...points].sort((left, right) => (left.x + left.y) - (right.x + right.y));
  const topLeft = bySum[0];
  const bottomRight = bySum[3];
  const remaining = bySum.slice(1, 3).sort((left, right) => (left.x - left.y) - (right.x - right.y));
  const bottomLeft = remaining[0];
  const topRight = remaining[1];
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
