import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

# ─── COLOR PALETTE ────────────────────────────────────────────────────────────
PRIMARY_COLOR = colors.HexColor("#0F172A")    # Dark slate
SECONDARY_COLOR = colors.HexColor("#334155")  # Muted slate
TEXT_COLOR = colors.HexColor("#000000")       # Black for formal legal
BORDER_COLOR = colors.HexColor("#CBD5E1")     # Light gray

# ─── PATHS ────────────────────────────────────────────────────────────────────
WORKSPACE_DIR = "/Users/user/Documents/Project X/Sivan"
DOCS_DIR = os.path.join(WORKSPACE_DIR, "docs")
HOME_PAGE_DIR = os.path.join(WORKSPACE_DIR, "home_page")

LOGO_PATH = os.path.join(HOME_PAGE_DIR, "public", "sivan-logo.png")
SAMSON_SIG_PATH = os.path.join(DOCS_DIR, "samson signautre.png")
JONATHAN_SIG_PATH = os.path.join(DOCS_DIR, "jonathan signature.jpeg")

HAS_LOGO = os.path.exists(LOGO_PATH)
HAS_SAMSON_SIG = os.path.exists(SAMSON_SIG_PATH)
HAS_JONATHAN_SIG = os.path.exists(JONATHAN_SIG_PATH)

# ─── CANVAS CALLBACKS FOR HEADER/FOOTER ───────────────────────────────────────
def draw_legal_decorations(canvas_obj, doc):
    canvas_obj.saveState()
    # Draw simple header and footer rules
    canvas_obj.setStrokeColor(BORDER_COLOR)
    canvas_obj.setLineWidth(0.5)
    # Header line
    canvas_obj.line(54, 738, 558, 738)
    # Footer line
    canvas_obj.line(54, 54, 558, 54)
    
    # Header text
    canvas_obj.setFont("Times-Bold", 8)
    canvas_obj.setFillColor(SECONDARY_COLOR)
    canvas_obj.drawString(54, 744, "DEED OF PARTNERSHIP: SIVAN TECHNOLOGIES")
    
    # Footer text
    canvas_obj.setFont("Times-Roman", 8)
    canvas_obj.setFillColor(SECONDARY_COLOR)
    canvas_obj.drawString(54, 42, "sivantech.online | Partnership Deed (Registered BN 9585790)")
    canvas_obj.drawRightString(558, 42, f"Page {canvas_obj._pageNumber}")
    canvas_obj.restoreState()

# ─── MAIN BUILDER ─────────────────────────────────────────────────────────────
def build_deed_pdf():
    # Setup document target paths
    target_path_docs = os.path.join(DOCS_DIR, "Sivan_Technologies_Partnership_Deed.pdf")
    target_path_public = os.path.join(HOME_PAGE_DIR, "public", "docs", "Sivan_Technologies_Partnership_Deed.pdf")
    
    # We will build to DOCS_DIR first, then copy to target_path_public
    doc = SimpleDocTemplate(
        target_path_docs,
        pagesize=letter,
        leftMargin=54,  # 0.75 in
        rightMargin=54, # 0.75 in
        topMargin=72,   # 1 in
        bottomMargin=72 # 1 in
    )

    styles = getSampleStyleSheet()

    # Define professional legal typography styles
    title_style = ParagraphStyle(
        'LegalTitle',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=15,
        leading=18,
        textColor=PRIMARY_COLOR,
        alignment=1, # Center
        spaceAfter=24
    )

    h2_style = ParagraphStyle(
        'LegalHeader2',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=11,
        leading=14,
        textColor=PRIMARY_COLOR,
        alignment=1, # Center
        spaceBefore=16,
        spaceAfter=8,
        keepWithNext=True
    )

    h2_left_style = ParagraphStyle(
        'LegalHeader2Left',
        parent=h2_style,
        alignment=0, # Left
        spaceBefore=14,
        spaceAfter=6
    )

    body_style = ParagraphStyle(
        'LegalBody',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=10.5,
        leading=16,
        textColor=TEXT_COLOR,
        alignment=4, # Justified
        spaceAfter=10,
        firstLineIndent=36 # 0.5 in
    )

    no_indent_style = ParagraphStyle(
        'LegalBodyNoIndent',
        parent=body_style,
        firstLineIndent=0
    )

    bullet_style = ParagraphStyle(
        'LegalBullet',
        parent=body_style,
        leftIndent=24,
        firstLineIndent=-12,
        spaceAfter=6
    )

    sign_label_style = ParagraphStyle(
        'SignLabel',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9.5,
        leading=13,
        textColor=TEXT_COLOR
    )

    story = []

    # 1. Logo (if available)
    if HAS_LOGO:
        logo_img = Image(LOGO_PATH, width=54, height=54)
        logo_img.hAlign = 'CENTER'
        story.append(logo_img)
        story.append(Spacer(1, 15))

    # 2. Main Title
    story.append(Paragraph("DEED OF PARTNERSHIP OF SIVAN TECHNOLOGIES", title_style))
    story.append(Spacer(1, 10))

    # 3. Preamble
    story.append(Paragraph("<b>THIS DEED OF PARTNERSHIP</b> is made and executed this <b>22nd day of June, 2026</b>,", no_indent_style))
    story.append(Spacer(1, 8))
    
    story.append(Paragraph("<b>BETWEEN:</b>", no_indent_style))
    
    story.append(Paragraph("<b>1. OLALAYE SAMSON</b>, of No. 1 Ebenezer Street, Byazhin Across, Kubwa, Bwari, Federal Capital Territory, Abuja, Nigeria (hereinafter referred to as the <b>\"First Partner\"</b> or the <b>\"Managing Partner\"</b>, which expression shall where the context so admits include his heirs, legal representatives, and assigns) of the FIRST PART;", no_indent_style))
    story.append(Spacer(1, 6))
    
    story.append(Paragraph("<b>AND</b>", no_indent_style))
    
    story.append(Paragraph("<b>2. JONATHAN HART</b>, of No. 4 Olayinka Awo, Off Byazhin, Kubwa, 900103, Nigeria (hereinafter referred to as the <b>\"Second Partner\"</b> or the <b>\"Operations Partner\"</b>, which expression shall where the context so admits include his heirs, legal representatives, and assigns) of the SECOND PART.", no_indent_style))
    story.append(Spacer(1, 6))

    story.append(Paragraph("The First Partner and the Second Partner are hereinafter individually referred to as a <b>\"Partner\"</b> and collectively as the <b>\"Partners.\"</b>", no_indent_style))
    story.append(Spacer(1, 12))

    # 4. Recitals
    story.append(Paragraph("WITNESSETH AS FOLLOWS:", h2_left_style))
    story.append(Paragraph("<b>WHEREAS:</b>", no_indent_style))
    
    story.append(Paragraph("A. The Partners have agreed to join together in a partnership business under the name and style of <b>SIVAN TECHNOLOGIES</b> (hereinafter referred to as the <b>\"Firm\"</b>), which business has been registered with the Corporate Affairs Commission of Nigeria (CAC) under Business Name Registration Number <b>BN 9585790</b>.", bullet_style))
    
    story.append(Paragraph("B. The Partners desire to record the terms, conditions, rights, and duties governing their business partnership in this Deed of Partnership.", bullet_style))
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>NOW, THEREFORE, IT IS MUTUALLY AGREED BY AND BETWEEN THE PARTNERS AS FOLLOWS:</b>", no_indent_style))
    story.append(Spacer(1, 10))

    # 5. Partnership Terms Clauses
    story.append(Paragraph("1. NAME OF THE FIRM", h2_left_style))
    story.append(Paragraph("The business of the Partnership shall be carried on under the registered name and style of <b>SIVAN TECHNOLOGIES</b>.", no_indent_style))

    story.append(Paragraph("2. NATURE OF BUSINESS", h2_left_style))
    story.append(Paragraph("The Partnership shall carry on the business of providing software engineering services, custom conversational applications, project and service agreement coordination platforms, low-latency transaction routing interfaces, administrative operational portals, and compliant payment coordination services, as well as any other lawful business that the Partners may mutually agree upon from time to time.", no_indent_style))

    story.append(Paragraph("3. PLACE OF BUSINESS", h2_left_style))
    story.append(Paragraph("The principal place of business of the Firm shall be located at <strong>No. 3 Olayinka Street, Byazhin Across, Kubwa, Federal Capital Territory, Abuja, Nigeria</strong>, or at such other place or places as the Partners may mutually decide from time to time.", no_indent_style))

    story.append(Paragraph("4. DURATION OF PARTNERSHIP", h2_left_style))
    story.append(Paragraph("The Partnership shall be deemed to have commenced on the 22nd day of June, 2026, and shall continue in perpetuity unless dissolved in accordance with the provisions of this Deed or by operation of the laws of the Federal Republic of Nigeria.", no_indent_style))

    story.append(Paragraph("5. CAPITAL AND CONTRIBUTION", h2_left_style))
    story.append(Paragraph("The initial capital required for the operation of the Partnership shall be contributed by the Partners in a ratio of 80:20 (80% by the First Partner and 20% by the Second Partner). Any further capital requirements shall be mutually agreed upon in writing, and contributed in the same proportion unless otherwise agreed.", no_indent_style))

    story.append(Paragraph("6. PROFIT AND LOSS SHARING", h2_left_style))
    story.append(Paragraph("The net profits of the Partnership business shall be divided between the Partners, and all losses shall be borne by them, in shares of 80% to the First Partner and 20% to the Second Partner. The accounting year of the Partnership shall end on the 31st day of December of each calendar year.", no_indent_style))

    story.append(Paragraph("7. BANKING ACCOUNTS", h2_left_style))
    story.append(Paragraph("All monies, checks, and securities received on account of the Partnership shall be deposited immediately in the Partnership's official bank accounts. All operations, checks, and electronic fund transfers from the Partnership's bank accounts shall be operated under the joint authorization of both Partners, or in accordance with written operational mandates signed by both Partners.", no_indent_style))

    story.append(Paragraph("8. MANAGEMENT, ROLES, AND RESPONSIBILITIES", h2_left_style))
    story.append(Paragraph("The management, administration, and execution of the Partnership's business shall be divided according to the core expertise of the Partners as follows:", no_indent_style))
    
    story.append(Paragraph("• <b>OLALAYE SAMSON (Managing Partner & Chief Executive Officer):</b> Shall take direct charge of product leadership, business direction, core technical design, database ledger implementation, compliance architecture, and coordination with technical regional payment infrastructure providers.", bullet_style))
    
    story.append(Paragraph("• <b>JONATHAN HART (Co-Founder & Operations Partner):</b> Shall lead operational support, merchant pilot onboarding, customer dispute mediation workflows, internal control mechanisms, administrative oversight, and coordination with support partners.", bullet_style))
    
    story.append(Paragraph("Both Partners shall devote their reasonable time and attention to the business of the Firm and shall act with utmost good faith in all transactions relating to the Partnership.", no_indent_style))

    story.append(Paragraph("9. BOOKS OF ACCOUNT", h2_left_style))
    story.append(Paragraph("The Partners shall cause proper books of accounts to be kept at the principal place of business of the Firm, detailing all receipts, payments, assets, liabilities, and transactions. Each Partner shall have free access to inspect, check, and copy the accounts and records at all reasonable times.", no_indent_style))

    story.append(Paragraph("10. DISSOLUTION AND RETIREMENT", h2_left_style))
    story.append(Paragraph("No Partner shall retire from the Partnership without giving at least three (3) months' written notice to the other Partner. In the event of retirement, dissolution, or incapacitation of a Partner, the assets and liabilities of the Partnership shall be valued by a mutually agreed professional auditor, and settlement shall be made in accordance with the capital contribution and profit-sharing ratio.", no_indent_style))

    story.append(Paragraph("11. GOVERNING LAW AND ARBITRATION", h2_left_style))
    story.append(Paragraph("This Deed of Partnership shall be governed by, and construed in accordance with, the laws of the Federal Republic of Nigeria. Any dispute, controversy, or claim arising out of or relating to this Deed, including its existence, validity, or termination, which cannot be amicably settled by mutual consultation within thirty (30) days, shall be referred to arbitration in accordance with the Arbitration and Mediation Act of Nigeria. The place of arbitration shall be Abuja, Nigeria, and the proceedings shall be conducted in English.", no_indent_style))
    story.append(Spacer(1, 10))

    # 6. Witness Preamble
    story.append(Paragraph("<b>IN WITNESS WHEREOF</b>, the Partners hereto have set their hands and seals the day and year first above written.", no_indent_style))
    story.append(Spacer(1, 20))

    # 7. Signature blocks (Keep together so it doesn't break across pages)
    sig_blocks = []
    
    # First Partner Sign Column
    samson_col = [
        Paragraph("<b>SIGNED, SEALED, AND DELIVERED</b> by the within-named <b>FIRST PARTNER</b>:<br/>", sign_label_style),
        Spacer(1, 5)
    ]
    if HAS_SAMSON_SIG:
        samson_col.append(Image(SAMSON_SIG_PATH, width=120, height=42, hAlign='LEFT'))
        samson_col.append(Spacer(1, 5))
    else:
        samson_col.append(Spacer(1, 40))
    
    samson_col.extend([
        Paragraph("_____________________________________", sign_label_style),
        Paragraph("<b>OLALAYE SAMSON</b>", sign_label_style),
        Paragraph("First Partner / Managing Partner", sign_label_style)
    ])

    # Second Partner Sign Column
    jonathan_col = [
        Paragraph("<b>SIGNED, SEALED, AND DELIVERED</b> by the within-named <b>SECOND PARTNER</b>:<br/>", sign_label_style),
        Spacer(1, 5)
    ]
    if HAS_JONATHAN_SIG:
        jonathan_col.append(Image(JONATHAN_SIG_PATH, width=120, height=42, hAlign='LEFT'))
        jonathan_col.append(Spacer(1, 5))
    else:
        jonathan_col.append(Spacer(1, 40))

    jonathan_col.extend([
        Paragraph("_____________________________________", sign_label_style),
        Paragraph("<b>JONATHAN HART</b>", sign_label_style),
        Paragraph("Second Partner / Operations Partner", sign_label_style)
    ])

    t_sigs = Table([[samson_col, jonathan_col]], colWidths=[250, 250])
    t_sigs.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 20),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    sig_blocks.append(t_sigs)
    # No witness block requested

    # Wrap the execution section in KeepTogether so it stays clean on the final page
    story.append(KeepTogether(sig_blocks))

    # Compile the PDF using the decorative legal page callback
    doc.build(
        story,
        onFirstPage=draw_legal_decorations,
        onLaterPages=draw_legal_decorations
    )
    
    # Copy from DOCS_DIR to target_path_public
    import shutil
    shutil.copyfile(target_path_docs, target_path_public)
    print("Success: Sivan_Technologies_Partnership_Deed.pdf compiled and copied.")

if __name__ == "__main__":
    build_deed_pdf()
