/*
  Azure Communication Services — P1 phone escalation + SMS fallback.
  Data location: Asia Pacific (closest to southeastasia).
  PDPA: Call recordings stored in Blob with CMK.
*/
param environmentName string
param location string
param resourceToken string
param tags object = {}

var acsName = 'acs-itsm3-${resourceToken}'

resource acs 'Microsoft.Communication/communicationServices@2023-06-01-preview' = {
  name: acsName
  location: 'global' // ACS is a global resource
  tags: tags
  properties: {
    dataLocation: 'Asia Pacific' // PDPA: Data stays in APAC
  }
}

output acsName string = acs.name
output acsEndpoint string = 'https://${acs.name}.communication.azure.com'
output acsResourceId string = acs.id
