# LINEFORGE — Gemini + Render Edition

Gemini API를 사용해서 업로드한 이미지를 **흰 배경 + 검은 선 중심의 라인아트 / 문신 스텐실 스타일**로 변환하는 웹사이트입니다.

## 포함 기능
- 깔끔한 UI/UX
- 모바일 최적화
- 업로드 후 **직접 드래그해서 영역 선택**
- 선택 박스 이동 / 모서리 드래그 크기 조절 / 전체 선택 / 영역 적용
- 오류 / 완료 / 안내 메시지 **화면 중앙 노출**
- 다크 / 화이트 모드
- Gemini API 연동
- Render 배포용 `render.yaml`
- GitHub 업로드용 루트 구조

## 파일 구조
- `index.html` : 메인 화면
- `styles.css` : UI 스타일
- `app.js` : 프론트엔드 로직
- `server.js` : Gemini API 연동 서버
- `package.json` : Node 실행 설정
- `render.yaml` : Render 배포 설정

## GitHub + Render 배포 방법
1. ZIP 압축 해제
2. 안의 파일들을 GitHub 저장소 루트에 그대로 업로드
3. Render에서 해당 GitHub 저장소를 연결
4. Render 환경변수 `GEMINI_API_KEY` 추가
5. 필요하면 `GEMINI_IMAGE_MODEL` 값 유지 또는 변경
6. Deploy 후 Render URL에서 사용

## 환경변수
- `GEMINI_API_KEY` : 필수
- `GEMINI_IMAGE_MODEL` : 선택 (기본값: `gemini-2.0-flash-preview-image-generation`)

## 주의
- Gemini 이미지 모델은 무료 사용량이 제한되거나 Billing 연결이 필요할 수 있습니다.
- 접속은 GitHub 저장소 URL이 아니라 **Render URL**에서 해야 정상 동작합니다.
