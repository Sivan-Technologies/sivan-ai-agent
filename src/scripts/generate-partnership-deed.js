const fs = require('fs');
const path = require('path');

function generateDeed() {
  const content = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' 
      xmlns:w='urn:schemas-microsoft-com:office:word' 
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="utf-8">
  <title>Deed of Partnership - Sivan Technologies</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #000000;
      margin: 1in;
    }
    h1 {
      font-size: 16pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      margin-bottom: 24pt;
    }
    h2 {
      font-size: 12pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      margin-top: 18pt;
      margin-bottom: 12pt;
    }
    p {
      text-align: justify;
      margin-bottom: 12pt;
      text-indent: 0.5in;
    }
    p.no-indent {
      text-indent: 0;
    }
    p.center {
      text-align: center;
      text-indent: 0;
    }
    ol {
      margin-bottom: 12pt;
    }
    li {
      margin-bottom: 8pt;
      text-align: justify;
    }
    .signature-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 36pt;
      border: none;
    }
    .signature-table td {
      border: none;
      width: 50%;
      padding: 10px;
      vertical-align: top;
    }
    .signature-line {
      border-top: 1px solid #000000;
      margin-top: 50px;
      padding-top: 5px;
    }
    .signature-img {
      max-height: 70px;
      max-width: 200px;
      display: block;
      margin-bottom: 5px;
    }
    .logo-container {
      text-align: center;
      margin-bottom: 20pt;
    }
    .logo-img {
      max-height: 60px;
    }
  </style>
</head>
<body>

  <div class="logo-container">
    <img class="logo-img" src="/Users/user/Documents/Project X/Sivan/home_page/public/sivan-logo.png" alt="Sivan Technologies Logo" />
  </div>

  <h1>DEED OF PARTNERSHIP</h1>
  
  <p class="no-indent"><strong>THIS DEED OF PARTNERSHIP</strong> is made and executed this <strong>22nd day of June, 2026</strong>,</p>

  <p class="no-indent"><strong>BETWEEN:</strong></p>

  <p class="no-indent"><strong>1. OLALAYE SAMSON</strong>, of No. 1 Ebenezer Street, Byazhin Across, Kubwa, Bwari, Federal Capital Territory, Abuja, Nigeria (hereinafter referred to as the <strong>"First Partner"</strong> or the <strong>"Managing Partner"</strong>, which expression shall where the context so admits include his heirs, legal representatives, and assigns) of the FIRST PART;</p>

  <p class="no-indent"><strong>AND</strong></p>

  <p class="no-indent"><strong>2. JONATHAN HART</strong>, of No. 4 Olayinka Awo, Off Byazhin, Kubwa, 900103, Nigeria (hereinafter referred to as the <strong>"Second Partner"</strong> or the <strong>"Operations Partner"</strong>, which expression shall where the context so admits include his heirs, legal representatives, and assigns) of the SECOND PART.</p>

  <p class="no-indent">The First Partner and the Second Partner are hereinafter individually referred to as a <strong>"Partner"</strong> and collectively as the <strong>"Partners."</strong></p>

  <h2>WITNESSETH AS FOLLOWS:</h2>

  <p class="no-indent"><strong>WHEREAS:</strong></p>
  
  <ol type="A">
    <li>The Partners have agreed to join together in a partnership business under the name and style of <strong>SIVAN TECHNOLOGIES</strong> (hereinafter referred to as the <strong>"Firm"</strong>), which business has been registered with the Corporate Affairs Commission of Nigeria (CAC) under Business Name Registration Number <strong>BN 9585790</strong>.</li>
    <li>The Partners desire to record the terms, conditions, rights, and duties governing their business partnership in this Deed of Partnership.</li>
  </ol>

  <p class="no-indent"><strong>NOW, THEREFORE, IT IS MUTUALLY AGREED BY AND BETWEEN THE PARTNERS AS FOLLOWS:</strong></p>

  <h2>1. NAME OF THE FIRM</h2>
  <p class="no-indent">The business of the Partnership shall be carried on under the registered name and style of <strong>SIVAN TECHNOLOGIES</strong>.</p>

  <h2>2. NATURE OF BUSINESS</h2>
  <p class="no-indent">The Partnership shall carry on the business of providing software engineering services, custom conversational applications, project and service coordination software platforms, low-latency transaction routing interfaces, administrative operational portals, and compliant financial technology coordination services, as well as any other lawful business that the Partners may mutually agree upon from time to time.</p>

  <h2>3. PLACE OF BUSINESS</h2>
  <p class="no-indent">The principal place of business of the Firm shall be located at <strong>No. 3 Olayinka Street, Byazhin Across, Kubwa, Federal Capital Territory, Abuja, Nigeria</strong>, or at such other place or places as the Partners may mutually decide from time to time.</p>

  <h2>4. COMMENCEMENT AND DURATION</h2>
  <p class="no-indent">The Partnership shall be deemed to have commenced on the 22nd day of June, 2026, and shall continue in perpetuity unless dissolved in accordance with the provisions of this Deed or by operation of the laws of the Federal Republic of Nigeria.</p>

  <h2>5. CAPITAL AND CONTRIBUTION</h2>
  <p class="no-indent">The initial capital required for the operation of the Partnership shall be contributed by the Partners in a ratio of 80:20 (80% by the First Partner and 20% by the Second Partner). Any further capital requirements shall be mutually agreed upon in writing, and contributed in the same proportion unless otherwise agreed.</p>

  <h2>6. PROFIT AND LOSS SHARING</h2>
  <p class="no-indent">The net profits of the Partnership business shall be divided between the Partners, and all losses shall be borne by them, in shares of 80% to the First Partner and 20% to the Second Partner. The accounting year of the Partnership shall end on the 31st day of December of each calendar year.</p>

  <h2>7. BANKING ACCOUNTS</h2>
  <p class="no-indent">All monies, checks, and securities received on account of the Partnership shall be deposited immediately in the Partnership's official bank accounts. All operations, checks, and electronic fund transfers from the Partnership's bank accounts shall be operated under the joint authorization of both Partners, or in accordance with written operational mandates signed by both Partners.</p>

  <h2>8. MANAGEMENT, ROLES, AND RESPONSIBILITIES</h2>
  <p class="no-indent">The management, administration, and execution of the Partnership's business shall be divided according to the core expertise of the Partners as follows:</p>
  <ul>
    <li><strong>OLALAYE SAMSON (Managing Partner & Chief Executive Officer):</strong> Shall take direct charge of product leadership, business direction, core technical design, database ledger implementation, compliance architecture, and coordination with technical regional payment infrastructure providers.</li>
    <li><strong>JONATHAN HART (Co-Founder & Operations Partner):</strong> Shall lead operational support, merchant pilot onboarding, customer dispute mediation workflows, internal control mechanisms, administrative oversight, and coordination with support partners.</li>
  </ul>
  <p class="no-indent">Both Partners shall devote their reasonable time and attention to the business of the Firm and shall act with utmost good faith in all transactions relating to the Partnership.</p>

  <h2>9. BOOKS OF ACCOUNT</h2>
  <p class="no-indent">The Partners shall cause proper books of accounts to be kept at the principal place of business of the Firm, detailing all receipts, payments, assets, liabilities, and transactions. Each Partner shall have free access to inspect, check, and copy the accounts and records at all reasonable times.</p>

  <h2>10. DISSOLUTION AND RETIREMENT</h2>
  <p class="no-indent">No Partner shall retire from the Partnership without giving at least three (3) months' written notice to the other Partner. In the event of retirement, dissolution, or incapacitation of a Partner, the assets and liabilities of the Partnership shall be valued by a mutually agreed professional auditor, and settlement shall be made in accordance with the capital contribution and profit-sharing ratio.</p>

  <h2>11. GOVERNING LAW AND ARBITRATION</h2>
  <p class="no-indent">This Deed of Partnership shall be governed by, and construed in accordance with, the laws of the Federal Republic of Nigeria. Any dispute, controversy, or claim arising out of or relating to this Deed, including its existence, validity, or termination, which cannot be amicably settled by mutual consultation within thirty (30) days, shall be referred to arbitration in accordance with the Arbitration and Mediation Act of Nigeria. The place of arbitration shall be Abuja, Nigeria, and the proceedings shall be conducted in English.</p>

  <p class="no-indent" style="margin-top: 30pt;"><strong>IN WITNESS WHEREOF</strong>, the Partners hereto have set their hands and seals the day and year first above written.</p>

  <table class="signature-table">
    <tr>
      <td>
        <strong>SIGNED, SEALED, AND DELIVERED</strong> by the within-named <strong>FIRST PARTNER</strong>:<br/><br/>
        <img class="signature-img" src="/Users/user/Documents/Project X/Sivan/docs/samson signautre.png" alt="Olalaye Samson Signature" /><br/>
        _____________________________________<br/>
        <strong>OLALAYE SAMSON</strong><br/>
        First Partner / Managing Partner
      </td>
      <td>
        <strong>SIGNED, SEALED, AND DELIVERED</strong> by the within-named <strong>SECOND PARTNER</strong>:<br/><br/>
        <img class="signature-img" src="/Users/user/Documents/Project X/Sivan/docs/jonathan signature.jpeg" alt="Jonathan Hart Signature" /><br/>
        _____________________________________<br/>
        <strong>JONATHAN HART</strong><br/>
        Second Partner / Operations Partner
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  // Write to Sivan/docs/
  const docPath1 = '/Users/user/Documents/Project X/Sivan/docs/Sivan_Technologies_Partnership_Deed.doc';
  fs.writeFileSync(docPath1, content.trim());
  console.log(`Successfully generated Partnership Deed at: ${docPath1}`);

  // Write to home_page/public/docs/
  const docPath2 = '/Users/user/Documents/Project X/Sivan/home_page/public/docs/Sivan_Technologies_Partnership_Deed.doc';
  fs.writeFileSync(docPath2, content.trim());
  console.log(`Successfully generated public Partnership Deed at: ${docPath2}`);
}

generateDeed();
