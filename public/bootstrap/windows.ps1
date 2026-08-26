$ErrorActionPreference = "Stop"
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.VisualStudioCode -e --accept-package-agreements --accept-source-agreements
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
winget install --id Postman.Postman -e --accept-package-agreements --accept-source-agreements
winget install --id Google.AndroidStudio -e --accept-package-agreements --accept-source-agreements
npm install -g eas-cli
Write-Host "RideArrivo engineering tools installed. Restart your terminal before use."
