{{/* Copied into helm-template by deploy_workspace; chart migration Job cannot isolate DDL Vault secrets. */}}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "superchart.name" . }}-bootstrap
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "10"
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 600
  template:
    metadata:
      annotations:
        {{- toYaml .Values.bootstrapPodAnnotations | nindent 8 }}
    spec:
      restartPolicy: Never
      automountServiceAccountToken: {{ .Values.serviceAccount.automount }}
      serviceAccountName: {{ include "superchart.serviceAccountName" . }}
      imagePullSecrets:
        {{- toYaml .Values.imagePullSecrets | nindent 8 }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: bootstrap
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          command: [pnpm, "deploy:workspace:bootstrap"]
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          env:
            - name: AWP_WORKSPACE_DATABASE_URL_FILE
              value: /vault/secrets/database_url
            - name: AWP_WORKSPACE_DATABASE_TLS
              value: disable
            - name: npm_config_verify_deps_before_run
              value: "false"
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
