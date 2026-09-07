# Windows code signing (Azure Trusted Signing)

The Windows `.exe` ships **unsigned** today, so Windows SmartScreen shows an "unknown publisher"
warning on first run (choose *More info → Run anyway*). The CI is already wired to sign it — the
signing step is **dormant** and turns on the moment the secrets below exist. No cert = the `.exe`
ships unsigned exactly as now; nothing breaks.

We use **Azure Trusted Signing**: Microsoft-run cloud signing, ~$9.99/month, **no hardware token**,
and it chains to Microsoft's own program so SmartScreen reputation builds quickly. (Traditional
OV/EV certs now require a physical USB token — unusable in cloud CI — so cloud signing is the only
CI-friendly route.)

## What the CI does
`.github/workflows/desktop-build.yml` has, on the Windows runner:
1. **Configure win signing** — sets `HAS_AZ=true` only if the `AZURE_CLIENT_ID` secret exists.
2. **Sign Windows installer** — runs `azure/trusted-signing-action` on `dist\*.exe` only when
   `HAS_AZ == 'true'`. It signs the built NSIS installer (the artifact users download and
   SmartScreen judges) and timestamps it via `timestamp.acs.microsoft.com`.

The app binaries *inside* the installer stay unsigned for now; signing the installer is the piece
that clears the download warning. Full inner-binary signing (via an electron-builder sign hook)
can follow once this is proven.

## Secrets to add (GitHub → repo Settings → Secrets and variables → Actions)
| Secret | What it is |
|---|---|
| `AZURE_TENANT_ID` | Entra (Azure AD) tenant ID |
| `AZURE_CLIENT_ID` | the app registration (service principal) client ID |
| `AZURE_CLIENT_SECRET` | that app registration's client secret |
| `AZURE_CODESIGN_ENDPOINT` | your Trusted Signing account region endpoint, e.g. `https://eus.codesigning.azure.net` |
| `AZURE_CODESIGN_ACCOUNT` | the Trusted Signing **account** name |
| `AZURE_CODESIGN_PROFILE` | the **certificate profile** name |

Once all six exist, the next `v*` tag produces a signed Windows installer automatically — no code
change needed.

## How to get the cert (Azure Trusted Signing)
1. **Azure account** — sign in at https://portal.azure.com (any Microsoft/Azure subscription;
   pay-as-you-go is fine).
2. **Create a Trusted Signing account** — portal → search **"Trusted Signing Accounts"** → Create.
   Pick a region (note its endpoint, e.g. East US → `https://eus.codesigning.azure.net`) and the
   **Basic** tier (~$9.99/mo). → this gives `AZURE_CODESIGN_ACCOUNT` + `AZURE_CODESIGN_ENDPOINT`.
3. **Identity validation** — in the Trusted Signing account, start **Identity validations**. For an
   individual it's a light KYC (name/address verified); for an organization it's a D-U-N-S/business
   check. This is the step that takes time (hours to a few days). The verified name becomes the
   publisher shown on the signature.
4. **Certificate profile** — once identity is Approved, create a **Certificate profile** (type
   *Public Trust*). Its name is `AZURE_CODESIGN_PROFILE`.
5. **Service principal for CI** — Entra ID → App registrations → New registration → add a **client
   secret**. That gives `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
6. **Grant it signing rights** — on the Trusted Signing account, IAM → Add role assignment →
   **Trusted Signing Certificate Profile Signer** → assign to the app registration from step 5.
7. Add the six secrets above to the GitHub repo. Done — tag a release and CI signs it.

Docs: https://learn.microsoft.com/azure/trusted-signing/

## Alternatives (if you'd rather not use Azure)
- **SSL.com eSigner** — cloud signing subscription; also CI-friendly (different action/secrets).
- **DigiCert KeyLocker** — enterprise, pricier.
- A traditional cert on a **USB token** can't be used in cloud CI (the token is physical); you'd
  sign on a local Windows box instead.
