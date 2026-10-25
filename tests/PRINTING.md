# 경고표지 인쇄 회귀검사

## 실행

Node 24, Python 3.12 기준:

```sh
npm ci
python -m pip install -r tests/requirements-print.txt
python -m playwright install --with-deps chromium
# Ubuntu에서 한글 글꼴 설치
sudo apt-get install -y fonts-noto-cjk
npm test
```

`npm test`는 JavaScript 검사 후 PDF 인쇄 검사를 실행한다. 개별 실행은
`npm run test:unit`, `npm run test:print`. `PYTHON`으로 Python 실행 파일,
`CHROMIUM_PATH`로 Chromium 경로, `PRINT_ARTIFACT_DIR`로 산출물 경로를 지정할 수 있다.
기본은 Playwright가 설치한 Chromium이다. `test:print`가 임의의 로컬 포트에서
Vite를 시작하고 종료한다. 단독 Python 실행 시에는 로컬 개발 서버와 `BASE_URL`이 필요하다.
개발 전용 `?preview=warning` 샘플을 사용하므로 production preview 서버는 사용하지 않는다.

## 자동 검사 범위

A4 1장, A5 2분할, A6 4분할, mini 8분할 각각 1매·한 페이지 가득·다음 페이지
1매 수량을 검사한다(A4 중복 제외 총 15개 사례). 마지막 수량은 긴 안전문구,
제품명, 공급업체명·연락처로도 검사한다. mini에는 안전문구 영역이 없으므로
긴 제품명·공급자 정보만 적용한다.

- 생성된 PDF를 216dpi로 렌더링해 각 페이지 QR을 디코딩하고 예상 페이지별 수량과 비교
- 인쇄 미디어에서 본문·QR·공급업체·실제 텍스트 조각의 경계 및 겹침 검사
- 긴 문구 끝의 테스트 문자열이 PDF 텍스트에도 남아 있는지 확인
- 외부 네트워크 요청 차단, 백엔드 환경값 제거, 예시 데이터만 사용

`artifacts/warning-print`에 사례별 PDF, 모든 PDF 페이지 PNG, DOM 이미지,
`results.json`, `summary.md`를 남긴다. 실패한 사례도 가능한 산출물을 먼저 저장한다.
Actions는 main push, PR 및 수동 실행을 지원하며 성공·실패에 관계없이 산출물을
14일 보관한다. Actions 실행 화면의 Summary와 Artifacts에서 확인한다.

## 실제 프린터 확인은 별도

이 검사는 Chromium이 생성한 PDF의 배치·QR 인식 검사다. 법정 내용의 정확성,
문자의 현장 가독성, 실제 프린터의 비인쇄 여백·드라이버 배율·잉크·용지는 보증하지 않는다.
특히 긴 문구를 축소해 담으면 잘림이 없어도 읽기 어려울 수 있으므로 확인이 필요하다.

현장 사용 전 각 크기 PDF를 100%/실제 크기, A4, 단면으로 출력하고 다음을 확인한다:

1. 테두리·제품명·그림문자·신호어·공급자/연락처·문구 끝이 모두 보이는지 확인
2. 각 칸의 QR을 실제 휴대전화로 스캔(예시 QR은 실제 MSDS가 아닌 테스트 ID)
3. 글자 크기와 대비, 절단 후 정보 누락 여부 확인
4. 실제 MSDS와 대조한 운영 표지로 QR 대상과 필수 정보 별도 확인

예시 PDF는 회귀검사용이며 현장 용기에 부착하지 않는다.
