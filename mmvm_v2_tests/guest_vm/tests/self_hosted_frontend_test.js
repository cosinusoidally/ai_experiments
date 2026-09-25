/* Integration contract for the self-hosted front end: its ordinary guest
 * compiler descriptor must be adopted as executable runtime-owned bytecode. */
var selfHostedFrontend = require("../self_hosted_frontend.js");
var selfHostedExecutable = selfHostedFrontend.compileExecutable(
    "assertEqual(6 * 7, 42, 'self-hosted output executes from the guest heap');",
    "<self-hosted-integration>");

selfHostedExecutable();

var selfHostedGlobal = this;
var selfHostedDeclarationExecutable = selfHostedFrontend.compileExecutable(
    "var selfHostedDeclared = selfHostedDeclared || {value: 42};",
    "<self-hosted-global-declaration>", null, selfHostedGlobal);
selfHostedDeclarationExecutable();
assertEqual(selfHostedGlobal.selfHostedDeclared.value, 42,
    "self-hosted execution instantiates global declarations before reads");
