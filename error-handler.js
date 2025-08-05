https://github.com/d3xb0t/estrategia-programadorimport { performance } from "perf_hooks";
import AuditService from '../services/audit/audit.service.js';
import AUDIT_ACTIONS from "../config/const.js";
import { loggerError } from "../utils/winston.js";

/**
 * Middleware centralizado para el manejo de errores.
 * Se activa cuando un controlador llama a `next(error)`.
 */
export const errorHandler = (error, request, response, next) => {
    const { auditContext } = response.locals;
    const { auditId, startTime } = auditContext;
    const {
        statusCode = 500,
        message = 'An unexpected error occurred',
        errorCode,
        auditAction = AUDIT_ACTIONS.UNKNOWN_FAILURE
    } = error;

    // Definimos los manejadores de errores en un Map
    const errorHandlers = new Map([
        [
            // Caso 1: Error de validación de Zod
            (err) => err.name === 'ZodError',
            (err) => {
                const validationErrors = err.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message
                }));

                const data = {
                    agent: 'ZOD',
                    action: AUDIT_ACTIONS.VALIDATION_FAILED,
                    ...auditContext,
                    metadata: {
                        error: 'Invalid request body',
                        details: validationErrors,
                        durationMS: performance.now() - startTime
                    }
                };

                AuditService.log(data);
                loggerError.info(data);

                return response.status(400).json({
                    status: 'error',
                    error: 'Invalid request body',
                    details: validationErrors,
                    auditId
                });
            }
        ],
        [
            // Caso 2: Error de duplicado en MongoDB (code 11000)
            (err) => err.code && err.code === 11000,
            (err) => {
                const data = {
                    agent: 'MONGOOSE',
                    action: auditAction,
                    ...auditContext,
                    metadata: {
                        error: message,
                        errorCode: err.code,
                        durationMS: performance.now() - startTime
                    }
                };

                AuditService.log(data);
                loggerError.info(data);

                return response.status(statusCode).json({
                    status: 'error',
                    error: message,
                    errorCode: err.code,
                    auditId
                });
            }
        ],
        [
            // Caso por defecto: Otros errores
            () => true, // Siempre coincide
            (err) => {
                const data = {
                    agent: 'UNKNOWN',
                    action: auditAction,
                    ...auditContext,
                    metadata: {
                        error: message,
                        errorCode: errorCode || 'UNKNOWN_ERROR',
                        durationMS: performance.now() - startTime
                    }
                };

                AuditService.log(data);
                loggerError.info(data);

                return response.status(statusCode).json({
                    status: 'error',
                    error: message,
                    errorCode,
                    auditId
                });
            }
        ]
    ]);

    // Buscamos el primer manejador que coincida con el error
    const matchedHandler = Array.from(errorHandlers.entries())
        .find(([condition]) => condition(error));

    // Ejecutamos el manejador correspondiente
    if (matchedHandler) {
        const [_, handler] = matchedHandler;
        handler(error);
    }
};
