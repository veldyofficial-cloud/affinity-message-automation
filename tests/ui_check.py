from pathlib import Path
html=Path(__file__).parents[1].joinpath('public/index.html').read_text()
assert 'id="approvalKey"' not in html
assert '$("approvalKey")' not in html
assert 'Cloudflare Access 직원 로그인' in html
assert 'credentials:"same-origin"' in html
assert '"1:1 브랜딩 코스"' in html
assert '[BRANDING] PERSONAL COURSE' in html
assert 'id="approve"' in html
print('UI static checks passed')
