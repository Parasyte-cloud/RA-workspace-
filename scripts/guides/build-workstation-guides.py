#!/usr/bin/env python3
"""Builds the workstation README PDFs into supabase/guides/<slug>/readme.pdf.

Department facts (capabilities, tools, links) are read straight from
src/modules/DepartmentTeamWorkspace.tsx so a guide cannot drift from the
workstation it describes. Daily routines and handling rules are written below.

    python3 scripts/guides/build-workstation-guides.py

Then publish with scripts/upload-workstation-guides.sh.
"""
import re, os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, KeepTogether, ListFlowable, ListItem

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VERSION = '3.0'
NAVY = colors.HexColor('#0b2342'); AMBER = colors.HexColor('#ff9900'); INK = colors.HexColor('#1d2b3c')
MUTE = colors.HexColor('#5b6b7e'); SOFT = colors.HexColor('#f3f6fa'); LINE = colors.HexColor('#d9e1ea')
W, H = A4
base = ParagraphStyle('b', fontName='Helvetica', fontSize=10, leading=15, textColor=INK, spaceAfter=6)
h1 = ParagraphStyle('h1', parent=base, fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=NAVY, spaceBefore=12, spaceAfter=5)
h2 = ParagraphStyle('h2', parent=base, fontName='Helvetica-Bold', fontSize=10.5, leading=14, textColor=NAVY, spaceBefore=6, spaceAfter=2)
small = ParagraphStyle('s', parent=base, fontSize=8.5, leading=12, textColor=MUTE)
cell = ParagraphStyle('c', parent=base, fontSize=9, leading=12.5, spaceAfter=0)
cellb = ParagraphStyle('cb', parent=cell, fontName='Helvetica-Bold', textColor=NAVY)

def esc(t): return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
def P(t, s=base): return Paragraph(t, s)
def bullets(items):
    return ListFlowable([ListItem(P(i), leftIndent=14, bulletColor=AMBER) for i in items], bulletType='bullet', start='•', leftIndent=14, bulletFontSize=10)
def table(rows, widths, head=True):
    data = [[P(c, cellb if (head and i == 0) or j == 0 else cell) for j, c in enumerate(r)] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    st = [('GRID', (0, 0), (-1, -1), .5, LINE), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]
    if head: st.append(('BACKGROUND', (0, 0), (-1, 0), SOFT))
    t.setStyle(TableStyle(st)); return [t, Spacer(1, 8)]
def note(title, text):
    t = Table([[P(f'<b>{title}</b><br/>{text}', cell)]], colWidths=[W - 44 * mm])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), SOFT), ('LINEBEFORE', (0, 0), (0, -1), 3, AMBER), ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    return KeepTogether([t, Spacer(1, 8)])

# ---------------------------------------------------------------- source facts
def parse_departments():
    s = open(os.path.join(ROOT, 'src/modules/DepartmentTeamWorkspace.tsx'), encoding='utf8').read()
    out = {}
    for p in re.split(r'\nexport function ', s):
        m = re.search(r'workstationSlug="([a-z-]+)"', p)
        if not m: continue
        g = lambda k: (re.search(k + r'="([^"]+)"', p) or [None, ''])[1]
        def block(name):
            mm = re.search(name + r'=\{\[(.*?)\]\}', p, re.S); return mm.group(1) if mm else ''
        un = lambda x: x.replace("\\'", "'")
        out[m.group(1)] = dict(
            eyebrow=g('eyebrow'), title=g('title'), subtitle=g('subtitle'), workstation=g('workstationTitle'), description=g('workstationDescription'),
            caps=[(un(a), un(b)) for a, b in re.findall(r"\{title:'((?:[^'\\]|\\.)*)',description:'((?:[^'\\]|\\.)*)'\}", block('capabilities'))],
            tools=[(un(a), un(b)) for a, b, _ in re.findall(r"\{name:'((?:[^'\\]|\\.)*)',purpose:'((?:[^'\\]|\\.)*)',url:'([^']*)'\}", block('tools'))],
            links=[(un(a), un(b)) for a, b, _ in re.findall(r"\{name:'((?:[^'\\]|\\.)*)',purpose:'((?:[^'\\]|\\.)*)',target:'([^']*)'\}", block('workspaceLinks'))])
    return out

# ------------------------------------------------------- written guidance
COMMON_RULES = [
    '<b>Your login is yours.</b> Never share it, and never sign in on a shared or public computer. Use <b>Keep me signed in</b> only on a device that only you use.',
    '<b>Lock or sign out</b> when you step away. Use the sign-out option at the end of the day.',
    '<b>Customer and company data stays in company tools.</b> Do not copy it into personal email, personal cloud drives or chat apps outside RideArrivo.',
    '<b>Company Files downloads need approval.</b> Open documents in the workspace first. Request a download only when you truly need the original.',
    '<b>Report problems early.</b> A lost device, a suspicious email or a wrong access level is reported to Administration the same day.',
]
EXTRA = {
 'executive': dict(who='Leadership and management.',
   start=['Open the Dashboard, then the Executive Scorecard, and read the exceptions first.','Clear the Approvals & Decisions queue so nobody is waiting on you.','Check Enterprise Risk for anything new overnight.'],
   during=['Record decisions where the team can see them, with an owner and a date.','Use the Company CRM and Applications links to reach detail instead of asking for screenshots.','Use Google Meet and ROOM 7 for meetings, and share the code in chat.'],
   end=['Leave no approval pending without a note saying why.','Skim Service & Operations and Financial Stewardship for tomorrow.'],
   care=['Banking access is for authorised people only. Never approve a payment from a link in a message; open the bank directly.','Board and governance material is confidential until the board releases it.']),
 'support': dict(who='Customer support agents and team leads.',
   start=['Open the Omnichannel Queue and check what is waiting and what is closest to breaching its SLA.','Read the shift handover note from the previous shift.','Check Safety Escalation for open cases before taking new ones.'],
   during=['Open Customer 360 and Live Ride Context before replying, so you answer with the real booking in front of you.','Use Knowledge & Macros for standard answers and personalise the first line.','Hand refunds and disputes to the right team with the Refund & Dispute Handoff; do not promise an outcome yourself.'],
   end=['Write a handover note: open cases, who is waiting, and what was promised.','Close or reassign every ticket you touched so none sits unowned.'],
   care=['Safety issues are escalated at once, not queued.','Never read out or send full card or ID details. Ask for the minimum needed to verify the person.']),
 'operations': dict(who='Dispatchers, fleet and airport coordinators, and operations leads.',
   start=['Open the ArrivoOps Control Centre and review today\'s trips, drivers on shift and any vehicle flagged for maintenance.','Check Inspections & Documents for expiring papers.','Read the Shift & Handover note.'],
   during=['Use the Dispatch Board and Live Trips & GPS to watch trips; assign or reassign drivers in Driver Assignment.','Use FlightAware and FlightRadar24 to confirm arrival times for airport pickups.','Log every incident in Safety & Incidents the moment it happens.'],
   end=['Complete the Shift & Handover note with open trips, issues and anything you told a driver.','Record fuel and utilisation figures while the day is fresh.'],
   care=['Driver and rider locations are sensitive. Share them only with people who need them to complete a trip.','Share the RideArrivo Driver Guide (the second guide on this page) with every new driver.']),
 'people': dict(who='HR and people operations.',
   start=['Check Recruitment & ATS for new applicants and interviews today.','Check Time, Leave & Attendance for requests waiting for a decision.','Check Onboarding & Offboarding for starters and leavers this week.'],
   during=['Keep every employee change in Employee Records so one record tells the truth.','Use Google Meet or ROOM 7 for interviews and send notes to the ATS straight after.','Use PenCom Employer Hub and LIRS eTax only for the statutory filings they exist for.'],
   end=['Update the status of every case you opened.','Make sure nothing confidential is left open on the screen.'],
   care=['Compensation, health, disciplinary and personal data stay inside HR. Do not paste any of it into chat or email.','Employee Relations cases are need-to-know. Do not discuss them outside the people involved.']),
 'engineering': dict(who='Engineers, DevOps and technical leads.',
   start=['Check Observability (Sentry, PostHog) for new errors and any release from yesterday.','Review open pull requests in Source Control & Review.','Check Security & DevSecOps for open findings.'],
   during=['Ship through CI/CD & Releases. Do not deploy by hand around the pipeline.','Use ParAsYtE Linux and the PArAsYtE Browser for work that needs the secure environment.','Change production data only through reviewed migrations.'],
   end=['Leave the main branch green.','Write down anything half done in the ticket, not in your head.'],
   care=['Secrets and API keys never go in chat, tickets or git. Use the platform\'s secret store.','Production access is least-privilege. Ask for what you need and give it back when done.']),
 'finance': dict(who='Finance and accounting.',
   start=['Check Cash & Banking for overnight movements and anything unmatched.','Review Payables and Receivables due this week.','Check the Close & Audit calendar for deadlines.'],
   during=['Match payments and settlements to ledger entries as they arrive instead of at month end.','Use FIRS TaxPro MAX, LIRS eTax and PenCom Employer Hub only for their statutory filings.','Keep working papers in Google Sheets or the workspace so an auditor can follow them.'],
   end=['Post what you reconciled today and flag what is still open.','Sign out of every tax and banking portal.'],
   care=['Finance data stays inside authorised roles. Do not forward statements or payroll details by email or chat.','Verify any change of bank details by a second channel before paying.']),
 'partnerships': dict(who='Business development and partnership managers.',
   start=['Open Partner CRM and review deals that moved or went quiet.','Check Pipeline & Forecast against this week\'s targets.','Check Agreements & Approvals for anything waiting for signature.'],
   during=['Log every partner conversation in the CRM the same day.','Send proposals from Proposals & Commercials and get approval before sending terms.','Use DocuSign for signatures so the audit trail is kept.'],
   end=['Update next steps and dates on every deal you touched.','Review Referrals & Commission entries for accuracy.'],
   care=['Pricing and commercial terms are confidential until approved.','Do not promise a launch date until Partner Onboarding confirms it.']),
 'legal': dict(who='Legal and compliance.',
   start=['Check Legal Intake for new requests and who owns them.','Open the Regulatory Calendar for deadlines in the next 30 days.','Check Contract Lifecycle for renewals and approvals due.'],
   during=['Work from Templates & Playbooks so terms stay consistent.','Record filings and registrations (CAC iCRP, NDPC) in the Compliance Register.','Keep investigation material in Evidence & Investigations, never in personal storage.'],
   end=['Update the status and next date on every matter you opened.','Make sure signed documents are filed with their audit trail.'],
   care=['Legal advice and privileged material are shared only with people who need it.','Evidence is preserved as found. Do not edit, rename or delete it.']),
}

def guide_from_department(slug, d):
    x = EXTRA[slug]
    return dict(slug=slug, eyebrow=d['eyebrow'] or d['workstation'].upper(), title=f"{d['workstation']}: README", who=x['who'],
        intro=d['description'] + ' ' + d['subtitle'],
        caps=d['caps'], tools=d['tools'], links=d['links'], start=x['start'], during=x['during'], end=x['end'], care=x['care'])

GUIDES_EXTRA = {
 'canonical': dict(eyebrow='YOUR WORKSPACE', title='RideArrivo Workspace: README', who='Every employee.',
   intro='The RideArrivo workspace is one place for your tasks, mail, calendar, chat, meetings and your department\'s tools. This guide is the quick start for everyone. Your own department has a more detailed README on its workstation page.',
   caps=[('Dashboard','Your day at a glance: notifications, what needs your attention, delivery KPI and your daily note.'),('Tasks','Assignments, deadlines and approvals.'),('Chat','Direct messages, rooms and department chat.'),('Mail','RideArrivo company email.'),('Calendar','Meetings, deadlines and events.'),('ROOM 7','RideArrivo\'s own video meetings, with chat and notes saved per meeting.'),('Company files, Archive and Brand Library','Controlled documents and approved brand assets.'),('Knowledge Base','Playbooks, procedures and answers written by the company.'),('My Profile','Your details, photo and sign-in sessions.')],
   tools=[], links=[],
   start=['Open the Dashboard and read Notifications and Needs your attention.','Check Tasks for what is due today.','Check Calendar for meetings and join with ROOM 7 where there is a code.'],
   during=['Use Chat for quick questions and Mail for anything that needs a record.','Search the Knowledge Base before asking; if the answer is missing, tell the admin team.','Put meeting notes where the team can find them.'],
   end=['Update your tasks so tomorrow starts clean.','Add a line to your Daily note.','Sign out on any device that is not yours alone.'],
   care=[]),
 'administration': dict(eyebrow='ADMINISTRATION', title='Administration Workstation: README', who='Workspace administrators.',
   intro='Authoritative, audited control of RideArrivo identity, people, security, workstations, performance, equipment and access. Everything you do here is logged, and you can see more than most people. Work carefully.',
   caps=[('People and access','Create and review accounts, roles and department membership. Remove access the day someone leaves.'),('Letterhead access','Choose who may issue official letterhead documents, and review what was issued.'),('AI Management','Review proposals from the Knowledge Manager before anything is published to the Knowledge Base.'),('Chat administration','Manage rooms and moderate where required.'),('Backups and operations','Check that scheduled backups ran and review operational exports.'),('Devices and equipment','Track company equipment and who holds it.'),('Performance','See delivery KPIs and how they are measured.')],
   tools=[], links=[],
   start=['Open Administration and read the overview for anything flagged.','Check Backups for yesterday\'s run.','Review new sign-ups and pending access requests.'],
   during=['Give the least access that does the job, and write the reason when you change a role.','Review AI Management proposals against their sources before approving.','Use the audit trail to answer "who changed this".'],
   end=['Leave no access request half done.','Sign out of Administration when finished.'],
   care=['Admin access is powerful. Never share it and never use it on a shared device.','Remove leavers\' access the same day.','Guide PDFs cannot be replaced from the app. Changes go through the engineering team.']),
 'marketing': dict(eyebrow='MARKETING', title='Marketing Workstation: README', who='Marketing team.',
   intro='Plan, create, publish and measure RideArrivo campaigns. Marketing has its own workspace tabs for the work, plus quick links to the everyday tools.',
   caps=[('Team','Who is in marketing and what they are working on.'),('Collaboration','Projects shared with colleagues, with invites and discussion in one place.'),('Discussion','Team conversation that stays with the work.'),('Digital Workstation','Paid acquisition, analytics, search and social tools in one place.'),('Strategy Workstation','Campaign planning and priorities.'),('Mood Board','Collect visual direction and references.'),('Intelligence','Market and competitor insight.'),('Wallet','Marketing budget and spend.'),('Finance Requests','Request money for campaigns through the approval route.'),('Execution','Track delivery of campaign work.')],
   tools=[('Google Ads','Search, display and campaign acquisition.'),('Google Analytics','Website and campaign performance.'),('Search Console','Search visibility and indexing.'),('Meta Business Suite','Facebook and Instagram pages and ads.'),('HubSpot Marketing','Email and lead nurturing.'),('Google Trends','What people are searching for.'),('PageSpeed Insights','Website speed checks.'),('Canva','Design and quick graphics.')], links=[],
   start=['Check Collaboration and Discussion for anything waiting for you.','Look at yesterday\'s numbers in Google Analytics.','Check the calendar for campaign dates.'],
   during=['Use the Brand Library for logos and approved assets, never an old copy.','Request spend through Finance Requests before you commit money.','Keep project files in the shared workspace so the team can see them.'],
   end=['Update Execution with what moved today.','Note what to test tomorrow.'],
   care=['Use only approved brand assets and wording.','Do not publish customer names, photos or testimonials without written permission.','Ad accounts and the marketing wallet are for authorised people only.']),
 'linux': dict(eyebrow='SECURE ENGINEERING ENVIRONMENT', title='ParAsYtE Linux: README', who='Engineers with approved access.',
   intro='ParAsYtE Linux is a secure terminal inside the workspace. Use it for engineering work that needs a controlled shell, instead of working from a personal machine.',
   caps=[('Terminal','A shell in your browser. The status bar shows Connected, Connecting, Attention or Disconnected.'),('Terminal size','Choose Normal, Expanded or Maximized, or use the maximize button.')], tools=[], links=[],
   start=['Open ParAsYtE Linux and wait for the status to show Connected.','Choose the terminal size that suits your screen.'],
   during=['Keep sessions short and purposeful.','If the status shows Attention or Disconnected, reload and reconnect before trusting any output.'],
   end=['Exit your session and close the tab.','Do not leave long-running work that nobody owns.'],
   care=['Never paste secrets, tokens or customer data into the terminal.','Everything you run can be audited. Run only what you are authorised to run.']),
}
for slug, g in GUIDES_EXTRA.items(): g['slug'] = slug

# ------------------------------------------------------------------ rendering
def render(g, out):
    def page(c, d):
        c.saveState()
        c.setFillColor(NAVY); c.rect(0, H - 14 * mm, W, 14 * mm, fill=1, stroke=0)
        c.setFillColor(AMBER); c.rect(0, H - 14 * mm, W, 1.2, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont('Helvetica-Bold', 8.5); c.drawString(22 * mm, H - 9 * mm, 'RIDEARRIVO INTERNAL')
        c.setFont('Helvetica', 8.5); c.drawRightString(W - 22 * mm, H - 9 * mm, f'Workstation README  |  Version {VERSION}  |  Internal use only')
        c.setFillColor(MUTE); c.setFont('Helvetica', 8); c.drawRightString(W - 22 * mm, 11 * mm, f'Page {d.page}')
        c.restoreState()
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=22 * mm, bottomMargin=18 * mm, title=g['title'], author='RideArrivo', subject='Workstation README')
    doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(22 * mm, 18 * mm, W - 44 * mm, H - 40 * mm)], onPage=page)])
    S = []
    S.append(P(g['eyebrow'], ParagraphStyle('e', parent=small, textColor=colors.HexColor('#b66e00'), fontName='Helvetica-Bold', spaceBefore=4)))
    S.append(P(esc(g['title']), ParagraphStyle('t', parent=h1, fontSize=22, leading=26, spaceBefore=0)))
    S.append(P(f"<b>Who this is for:</b> {esc(g['who'])}", base))
    S.append(P(esc(g['intro'])))
    S.append(P('1. Your first 15 minutes', h1))
    S.append(bullets(['Sign in and check the Dashboard: notifications, what needs your attention and your tasks.', 'Open this workstation from the left menu and read the section list below once.', 'Find your colleagues in Chat and say hello in the department room.', 'Open ROOM 7 and note where meetings start, so the first call is not a scramble.']))
    S.append(P('2. What you can do here', h1))
    S += table([['Area', 'What it is for']] + [[esc(a), esc(b)] for a, b in g['caps']], [50 * mm, W - 44 * mm - 50 * mm])
    if g['tools'] or g['links']:
        S.append(P('3. Tools and shortcuts', h1))
        S.append(P('Tools open in a new browser tab and use your own sign-in to that service. Request access from Administration if one is missing.'))
        rows = [['Tool or link', 'Use it for']] + [[esc(a), esc(b)] for a, b in g['tools']] + [[esc(a) + ' (inside the workspace)', esc(b)] for a, b in g['links']]
        S += table(rows, [50 * mm, W - 44 * mm - 50 * mm])
    n = 4 if (g['tools'] or g['links']) else 3
    S.append(P(f'{n}. A working day', h1))
    S.append(P('Start of day', h2)); S.append(bullets(g['start']))
    S.append(P('During the day', h2)); S.append(bullets(g['during']))
    S.append(P('End of day', h2)); S.append(bullets(g['end']))
    S.append(P(f'{n+1}. Security and handling', h1))
    S.append(bullets(COMMON_RULES))
    if g['care']:
        S.append(Spacer(1, 4)); S.append(note('For this department', '<br/>'.join('• ' + c for c in g['care'])))
    S.append(KeepTogether([
        P(f'{n+2}. Getting help', h1),
        P('Ask in your department room in Chat first. For access, accounts or anything that looks wrong with the workspace itself, message Administration with a screenshot and the time it happened. If you think your account or a device has been compromised, say so at once.'),
        Spacer(1, 4),
        P(f'Read-only guide, published by the engineering team. Version {VERSION}. If the app and this guide disagree, the app is right; tell Administration so the guide can be corrected.', small),
    ]))
    doc.build(S)

def main():
    deps = parse_departments()
    guides = {}
    for slug in EXTRA:
        if slug not in deps: sys.exit(f'department {slug} not found in DepartmentTeamWorkspace.tsx')
        guides[slug] = guide_from_department(slug, deps[slug])
    guides.update(GUIDES_EXTRA)
    for slug, g in guides.items():
        d = os.path.join(ROOT, 'supabase', 'guides', slug); os.makedirs(d, exist_ok=True)
        out = os.path.join(d, 'readme.pdf'); render(g, out)
        print('wrote', os.path.relpath(out, ROOT))
if __name__ == '__main__': main()
