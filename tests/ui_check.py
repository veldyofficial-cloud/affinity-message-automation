from pathlib import Path
html=Path(__file__).parents[1].joinpath('public/index.html').read_text()
assert 'id="approvalKey"' not in html
assert '$("approvalKey")' not in html
assert 'Cloudflare Access 직원 로그인' in html
assert 'credentials:"same-origin"' in html
assert '"[BRANDING] PERSONAL COURSE"' in html
assert '[BRANDING] PERSONAL COURSE' in html
assert 'id="approve"' in html
print('UI static checks passed')

assert 'id="requestedClosureScope"' in html
assert 'STUDENT_ABSENCE' in html
assert 'id="absenteeStudents"' in html
assert '[PICTURE BOOK] DIPLOMA' in html
assert '[DRAWING] BASIC' in html
assert '[MARKETING] MANAGEMENT' in html
assert '[ART BOOK DESIGN] LV.4' in html
assert 'MONDAY_TEACHERS' in html
