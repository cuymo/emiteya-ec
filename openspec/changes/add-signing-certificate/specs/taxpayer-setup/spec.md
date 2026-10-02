# Spec Delta

## MODIFIED Requirements

### Requirement: Preparación para emitir
El sistema SHALL mostrar a administradores y operadores la preparación para emitir de su empresa como una lista de requisitos, cada uno cumplido o pendiente: datos de la empresa registrados, al menos un punto de emisión disponible y una firma electrónica utilizable. La empresa está preparada para emitir solo si todos se cumplen. La lista muestra también el ambiente vigente.

#### Scenario: Empresa nueva
- **WHEN** un usuario consulta la preparación de una empresa recién aprovisionada
- **THEN** la empresa no está preparada para emitir
- **AND** los tres requisitos figuran como pendientes y el ambiente es `Pruebas`

#### Scenario: Configuración mínima completa sin firma
- **WHEN** la empresa tiene sus datos registrados y un punto de emisión disponible
- **THEN** esos dos requisitos figuran como cumplidos
- **AND** la firma electrónica figura como pendiente y la empresa no está preparada para emitir

#### Scenario: Se desactiva el último punto disponible
- **WHEN** un administrador desactiva el único punto de emisión disponible
- **THEN** el requisito de punto de emisión vuelve a figurar como pendiente

#### Scenario: Empresa preparada para emitir
- **WHEN** la empresa tiene sus datos registrados, un punto de emisión disponible y una firma electrónica utilizable
- **THEN** los tres requisitos figuran como cumplidos y la empresa está preparada para emitir

#### Scenario: Firma por vencer
- **WHEN** la firma electrónica de la empresa está por vencer pero sigue vigente
- **THEN** el requisito de firma electrónica sigue cumplido

#### Scenario: Firma que deja de ser utilizable
- **WHEN** la firma electrónica de la empresa vence o su secreto ya no puede abrirse
- **THEN** el requisito de firma electrónica vuelve a figurar como pendiente y la empresa no está preparada para emitir
