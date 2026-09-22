# LINEFORGE — GitHub + Render 배포용

이 ZIP은 **GitHub에 그대로 업로드하는 최종본**입니다.
API 키는 소스에 들어있지 않으며, Render에서 비공개 환경변수로 한 번만 입력하면 됩니다.

## 가장 쉬운 배포 방법

### 1. GitHub에 업로드
1. GitHub에서 새 저장소를 만듭니다.
2. 이 ZIP을 압축 해제합니다.
3. 압축을 풀었을 때 나온 파일들을 **전부 저장소 최상위(root)** 에 업로드합니다.
4. Commit 합니다.

중요: `.env` 파일이나 실제 Gemini API 키를 GitHub에 올리지 마세요.

### 2. Render에 GitHub 연결
1. https://render.com 에 로그인합니다.
2. `New` → `Blueprint`를 선택합니다.
3. 방금 만든 GitHub 저장소를 연결합니다.
4. 저장소 루트의 `render.yaml`이 자동으로 인식됩니다.

### 3. Gemini API 키 입력
Render가 `GEMINI_API_KEY` 값을 요구하면 본인의 Gemini API 키를 입력합니다.
이 값은 GitHub 소스에 저장되지 않습니다.

그 다음 Deploy / Apply를 진행하면 됩니다.
배포가 끝나면 Render가 `https://...onrender.com` 형식의 사이트 주소를 제공합니다.

## 필요한 값
- GEMINI_API_KEY : 직접 입력
- GEMINI_IMAGE_MODEL : render.yaml에 이미 설정됨
- GEMINI_IMAGE_SIZE : render.yaml에 이미 설정됨

## 주의
GitHub Pages는 사용하지 마세요. 이 프로젝트는 `server.js` Node 서버가 필요합니다.
