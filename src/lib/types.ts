export type AppRole = "ROOT" | "ADMINISTRATOR" | "OPERATOR" | "VIEWER";
export type ReportStatus = "DRAFT" | "SUBMITTED" | "CLOSED" | "CANCELLED";

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  job_title: string | null;
  active: boolean;
}

export interface Option {
  id: string;
  code: string;
  name: string;
  active?: boolean;
}

export const roleLabels: Record<AppRole, string> = {
  ROOT: "Administrador raíz",
  ADMINISTRATOR: "Coordinador",
  OPERATOR: "Operario",
  VIEWER: "Auditor",
};

export const statusLabels: Record<ReportStatus, string> = {
  DRAFT: "Activo",
  SUBMITTED: "Enviado",
  CLOSED: "Cerrado (aprobado)",
  CANCELLED: "Cancelado",
};
