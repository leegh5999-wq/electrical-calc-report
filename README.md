# 전기계산서 (웹앱)

전기 설계용 계산서.

기준: KEC 2026 · KDS · KECG 1701-2021

## 구성

### 계산서 6장
1. **변압기 용량 계산** — 부하 집계, KS 표준 자동 선정, 부하율 한계 판정
2. **발전기 용량 계산** — 정전/화재시 부하 분리, KS 표준 자동, MCC 기동전류 영향 분석
3. **전압강하 계산** — 분기 + 누적(간선) VD, KEC 한계 6%, 권장 단면적 자동 제안
4. **MCC 동력부하 계산** — 모터별 IB/IMS/II/tm 자동 (β, C, λ, k, tm은 설계조건에서)
5. **분전반 부하계산서** — 부모-자식 트리, 자체/자식/총 부하 분리, 조명기구 자동 채움
6. **케이블 트레이** — 외경 합, 단면적, 적재율, 권장 폭

### 참조 자료 (편집 가능)
- **설계조건** — 공사방법 A1~F, 도체 단면적, 차단기, 전동기 기동전류 (4섹션 50+ 파라미터)
- **조명기구**, **장비일람**, **수용률**, **차단기 (CB)**, **케이블 데이터**, **감쇄계수 (DF)**

### 자동 연동
- 분전반 회로의 케이블 → 전압강하 자동 점검
- MCC 모터의 운전전류 → 전압강하 자동 점검
- 루트 분전반 + MCC 총부하 → 변압기/발전기 부하 자동 집계 (자식 중복 회피)
- MCC-F (소방) → 발전기 화재시·정전시 자동 분류
- 모든 모터 IMS → 발전기 순차/동시 기동영향 분석
- 설계조건 값 변경 시 모든 계산기 즉시 반영

## 로컬에서 실행

브라우저가 ES 모듈 + `fetch()` 로 JSON 룩업 테이블을 읽기 때문에 정적 서버가 필요합니다.

```bash
# Windows에 Python이 있다면
py -m http.server 8765

# 또는 Node 의 serve
npx serve -p 8765
```

브라우저에서 `http://127.0.0.1:8765/` 접속.

## 데이터 관리

- 모든 입력은 브라우저 **localStorage**에 자동 저장 (페이지 닫아도 유지)
- 헤더의 **내보내기** 버튼 → 프로젝트 전체를 JSON 파일로 다운로드
- **불러오기** 버튼 → 다른 PC에서 작업하던 JSON 파일 로드
- 참조 자료 (조명기구, CB 등)도 함께 저장됨

## 프로젝트 구조

```
.
├── index.html                       # 셸 + 사이드바
├── css/style.css
├── js/
│   ├── app.js                       # 라우터 + 부트스트랩
│   ├── storage.js                   # localStorage + import/export
│   ├── lib/
│   │   ├── tables.js                # 룩업 테이블 로더
│   │   ├── format.js                # 한국어 숫자 포맷
│   │   ├── design_schema.js         # 설계조건 스키마
│   │   └── panel_picker.js          # 분전반/MCC 선택 모달
│   ├── calculators/
│   │   ├── transformer.js
│   │   ├── generator.js
│   │   ├── panels.js                # 분전반 트리
│   │   ├── mcc.js                   # MCC + 모터 계산
│   │   ├── voltage_drop.js
│   │   └── trays.js
│   └── views/
│       ├── design_conditions.js
│       ├── lighting_editor.js
│       └── generic_editor.js        # 다른 참조 자료
├── data/tables/                     # 7개 JSON 시드 (원본 엑셀에서 추출)
├── docs/
│   ├── sheet-map.md                 # 원본 엑셀 73시트 분석
│   └── excel_structure.json         # 의존성 그래프
└── tools/                           # 파이썬 추출 스크립트 (배포에 불필요)
    ├── extract_excel_structure.py
    └── extract_table.py
```

## 원본 엑셀과의 차이

- 시트 간 `INDIRECT("'"&$B10&"'!$AT$4")` 참조 → **분전반 트리 + parentPanelId** 로 명시적 모델링
- 분전반 시트 40개 사전 로드 → **CRUD** (현장마다 다른 분전반 명칭/수량)
- VLOOKUP 룩업 → **JSON 시드 + localStorage 편집본**

## 라이선스

내부 사용. (필요 시 사용자가 라이선스 추가)
